import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { nowIso, safeFileName, worktreeRoot } from "./config.mjs";
import { formatFinal } from "./presenter.mjs";
import { buildRunnerPrompt } from "./prompt.mjs";

const execFileP = promisify(execFile);

export class CodexCliRunner {
  constructor({ queue, config, notifier }) {
    this.queue = queue;
    this.config = config;
    this.notifier = notifier;
    this.busy = false;
  }

  async processAll() {
    if (this.busy || this.config.runner?.workerEnabled === false) return;
    this.busy = true;
    try {
      while (true) {
        const command = await this.queue.claimNext();
        if (!command) return;
        await this.#runOne(command);
      }
    } finally {
      this.busy = false;
    }
  }

  async #runOne(command) {
    if (command.mode === "thread_handoff") return this.#runHandoffOne(command);

    try {
      await this.#notify(command, `Task started: ${command.id}`);
      const prepared = await this.#prepareWorktree(command);
      command = await this.queue.update(
        command.id,
        {
          worktreePath: prepared.worktreePath,
          branchName: prepared.branchName,
        },
        "worktree_prepared",
      );

      const prompt = buildRunnerPrompt(command, this.config);
      const result = await this.#runCodex(command, prompt);
      const diffSummary = await gitMaybe(["-C", command.worktreePath, "diff", "--stat"]);
      const filesChanged = await gitMaybe(["-C", command.worktreePath, "diff", "--name-only"]);
      const hasChanges = filesChanged.trim().length > 0;

      const updated = await this.queue.update(
        command.id,
        {
          status: result.exitCode === 0 ? (hasChanges ? "waiting_review" : "completed") : "failed",
          result: result.finalMessage || result.stdoutTail || "",
          diffSummary: diffSummary.trim(),
          testSummary: "",
          error: result.exitCode === 0 ? "" : result.stderrTail || `Codex exited with ${result.exitCode}`,
          completedAt: nowIso(),
        },
        result.exitCode === 0 ? "codex_completed" : "codex_failed",
      );
      await this.#notify(updated, formatFinal(updated));
    } catch (error) {
      const failed = await this.queue.update(
        command.id,
        {
          status: "failed",
          error: error.message,
          completedAt: nowIso(),
        },
        "runner_error",
      );
      await this.#notify(failed || command, formatFinal(failed || { ...command, status: "failed", error: error.message }));
    }
  }

  async #prepareWorktree(command) {
    const repo = this.config.repos?.[command.repoKey];
    if (!repo?.path) throw new Error(`Repo is not configured: ${command.repoKey}`);
    const worktrees = worktreeRoot(this.config.dataDir);
    await fs.mkdir(worktrees, { recursive: true });
    const branchName = `codex-lark/${safeFileName(command.id)}`;
    const worktreePath = path.join(worktrees, safeFileName(command.id));
    try {
      await fs.access(worktreePath);
      return { branchName, worktreePath };
    } catch {
      // Worktree does not exist yet.
    }
    await execFileP("git", [
      "-C",
      repo.path,
      "worktree",
      "add",
      "-b",
      branchName,
      worktreePath,
      repo.baseBranch || "HEAD",
    ]);
    return { branchName, worktreePath };
  }

  async #runCodex(command, prompt) {
    const runner = this.config.runner || {};
    const args = buildCodexExecArgs({ runner, worktreePath: command.worktreePath, prompt });

    return runProcess(runner.codexPath || "codex", args, {
      timeoutMs: Number(runner.timeoutMs || 30 * 60 * 1000),
    });
  }

  async #runHandoffOne(command) {
    try {
      if (command.notifyStarted || this.config.handoff?.notifyStarted === true) {
        await this.#notify(command, `Codex started: ${command.id}`);
      }
      const prompt = buildHandoffPrompt(command, { promptStyle: this.config.handoff?.promptStyle || "direct" });
      const result = await this.#runCodexResume(command, prompt);
      const diffSummary = command.projectRoot ? await gitMaybe(["-C", command.projectRoot, "diff", "--stat"]) : "";

      const updated = await this.queue.update(
        command.id,
        {
          status: result.exitCode === 0 ? "completed" : "failed",
          result: result.finalMessage || result.stdoutTail || "",
          diffSummary: diffSummary.trim(),
          testSummary: "",
          error: result.exitCode === 0 ? "" : result.stderrTail || `Codex exited with ${result.exitCode}`,
          completedAt: nowIso(),
        },
        result.exitCode === 0 ? "codex_resume_completed" : "codex_resume_failed",
      );
      await this.#notify(updated, formatFinal(updated));
    } catch (error) {
      const failed = await this.queue.update(
        command.id,
        {
          status: "failed",
          error: error.message,
          completedAt: nowIso(),
        },
        "runner_error",
      );
      await this.#notify(failed || command, formatFinal(failed || { ...command, status: "failed", error: error.message }));
    }
  }

  async #runCodexResume(command, prompt) {
    const runner = this.config.runner || {};
    const resultsDir = path.join(this.config.dataDir, "results");
    await fs.mkdir(resultsDir, { recursive: true });
    const outputFile = path.join(resultsDir, `${safeFileName(command.id)}.txt`);
    const args = buildCodexResumeArgs({ runner, threadId: command.codexSessionId, prompt, outputFile });
    const result = await runProcess(runner.codexPath || "codex", args, {
      timeoutMs: Number(runner.timeoutMs || 30 * 60 * 1000),
    });
    try {
      const finalFromFile = (await fs.readFile(outputFile, "utf8")).trim();
      if (finalFromFile) result.finalMessage = finalFromFile;
    } catch {
      // The JSONL stream remains the source of truth when -o cannot write.
    }
    return result;
  }

  async #notify(command, text) {
    if (!this.notifier) return;
    try {
      const delivery = normalizeDelivery(await this.notifier.reply(command.messageId, text));
      if (!delivery.ok) throw new Error(delivery.error || "Lark reply failed");
      await this.queue.update(
        command.id,
        {
          lastNotifyError: "",
          lastNotifyAt: nowIso(),
          lastNotifyMessageId: delivery.messageId || command.lastNotifyMessageId || "",
        },
        "notify_sent",
      );
    } catch (error) {
      await this.queue
        .update(command.id, { lastNotifyError: error.message, lastNotifyAt: nowIso() }, "notify_failed")
        .catch(() => {});
    }
  }
}

export function buildCodexExecArgs({ runner = {}, worktreePath, prompt }) {
  const args = ["exec", "--json"];
  if (runner.ignoreUserConfig !== false) args.push("--ignore-user-config");
  args.push("--sandbox", runner.sandbox || "workspace-write", "-C", worktreePath);
  if (runner.model) args.push("-m", runner.model);
  args.push(prompt);
  return args;
}

export function buildCodexResumeArgs({ runner = {}, threadId, prompt, outputFile }) {
  if (!threadId) throw new Error("Codex handoff thread id is required");
  const args = ["exec", "resume", "--json"];
  if (runner.ignoreUserConfig !== false) args.push("--ignore-user-config");
  if (runner.model) args.push("-m", runner.model);
  if (outputFile) args.push("-o", outputFile);
  args.push(threadId, prompt);
  return args;
}

export function buildHandoffPrompt(command, { promptStyle = "direct" } = {}) {
  if (promptStyle === "direct") return command.prompt || "";

  return [
    "[Codex Lark Remote handoff]",
    "The user is sending this message from Feishu/Lark to continue the current Codex conversation.",
    `Sender: ${command.userName || "lark_user"}${command.userIdHash ? ` (${command.userIdHash})` : ""}`,
    "",
    "User message:",
    command.prompt,
  ].join("\n");
}

function normalizeDelivery(delivery) {
  if (delivery === true) return { ok: true };
  if (delivery === false || !delivery) return { ok: false, error: "Lark reply returned false" };
  return delivery;
}

async function runProcess(command, args, { timeoutMs }) {
  return new Promise((resolve) => {
    const child = execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      const exitCode = typeof error?.code === "number" ? error.code : error ? 1 : 0;
      resolve({
        exitCode,
        stdout,
        stderr,
        stdoutTail: tail(stdout),
        stderrTail: tail(stderr),
        finalMessage: extractFinalMessage(stdout),
      });
    });
    child.stdin?.end();
  });
}

async function gitMaybe(args) {
  try {
    const { stdout } = await execFileP("git", args, { maxBuffer: 1024 * 1024 });
    return stdout || "";
  } catch {
    return "";
  }
}

export function extractFinalMessage(stdout) {
  let final = "";
  for (const line of String(stdout || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const text = event.item?.text || event.message || event.text || event.content || event.delta;
      if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof text === "string") {
        final = text.trim();
      }
      if (typeof text === "string" && text.trim()) final = text.trim();
      if (event.type && /final|assistant|message/i.test(event.type) && typeof text === "string") {
        final = text.trim();
      }
    } catch {
      // Non-JSON output is ignored for final extraction; tail is kept as fallback.
    }
  }
  return final;
}

function tail(value, max = 3000) {
  const text = String(value || "");
  return text.length > max ? text.slice(-max) : text;
}
