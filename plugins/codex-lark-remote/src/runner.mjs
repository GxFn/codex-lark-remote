import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { nowIso, safeFileName, worktreeRoot } from "./config.mjs";
import { formatFinal, formatProgress } from "./presenter.mjs";
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
      cwd: command.worktreePath,
    });
  }

  async #runHandoffOne(command) {
    try {
      if (command.notifyStarted || this.config.handoff?.notifyStarted === true) {
        await this.#notify(command, `Codex started: ${command.id}`);
      }
      const progressNotifier = createProgressNotifier({
        command,
        config: this.config,
        notify: (text) => this.#notify(command, text),
      });
      const prompt = buildHandoffPrompt(command, { promptStyle: this.config.handoff?.promptStyle || "direct" });
      const result = await this.#runCodexResume(command, prompt, { onEvent: progressNotifier });
      const diffSummary = command.projectRoot ? await gitMaybe(["-C", command.projectRoot, "diff", "--stat"]) : "";

      const updated = await this.queue.update(
        command.id,
        {
          status: result.exitCode === 0 ? "completed" : "failed",
          result: result.finalMessage || result.stdoutTail || "",
          progressSummary: result.progressSummary || "",
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

  async #runCodexResume(command, prompt, { onEvent } = {}) {
    const runner = this.config.runner || {};
    const resultsDir = path.join(this.config.dataDir, "results");
    await fs.mkdir(resultsDir, { recursive: true });
    const outputFile = path.join(resultsDir, `${safeFileName(command.id)}.txt`);
    const args = buildCodexResumeArgs({
      runner,
      threadId: command.codexSessionId,
      prompt,
      outputFile,
      cwd: command.projectRoot,
    });
    const result = await runProcess(runner.codexPath || "codex", args, {
      timeoutMs: Number(runner.timeoutMs || 30 * 60 * 1000),
      cwd: command.projectRoot || undefined,
      onEvent,
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

export function buildCodexResumeArgs({ runner = {}, threadId, prompt, outputFile, cwd }) {
  if (!threadId) throw new Error("Codex handoff thread id is required");
  const args = ["exec"];
  if (runner.ignoreUserConfig !== false) args.push("--ignore-user-config");
  args.push("--sandbox", runner.sandbox || "workspace-write");
  if (cwd) args.push("-C", cwd);
  args.push("resume", "--json");
  if (runner.skipGitRepoCheck !== false) args.push("--skip-git-repo-check");
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

async function runProcess(command, args, { timeoutMs, cwd, onEvent }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const progress = [];
    let stdout = "";
    let stderr = "";
    let stdoutLineBuffer = "";
    let timedOut = false;
    let progressChain = Promise.resolve();
    let resolved = false;

    const finish = async ({ code, signal, error } = {}) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if (error) stderr = appendLimited(stderr, error.message);
      if (stdoutLineBuffer.trim()) handleJsonLine(stdoutLineBuffer);
      await progressChain.catch(() => {});
      const exitCode = timedOut ? 124 : typeof code === "number" ? code : error ? 1 : signal ? 1 : 0;
      resolve({
        exitCode,
        stdout,
        stderr,
        stdoutTail: tail(stdout),
        stderrTail: tail(stderr),
        finalMessage: extractFinalMessage(stdout),
        progressSummary: progress.slice(-12).join("\n"),
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);
    timer.unref?.();

    const handleJsonLine = (line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        const summary = summarizeCodexEvent(event);
        if (summary && progress[progress.length - 1] !== summary) progress.push(summary);
        if (onEvent && summary) {
          progressChain = progressChain
            .then(() => onEvent(event, summary))
            .catch(() => {});
        }
      } catch {
        // Non-JSON output is kept in stdout for final fallback.
      }
    };

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout = appendLimited(stdout, text);
      stdoutLineBuffer += text;
      const lines = stdoutLineBuffer.split(/\r?\n/);
      stdoutLineBuffer = lines.pop() || "";
      for (const line of lines) handleJsonLine(line);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk.toString("utf8"));
    });
    child.on("error", (error) => finish({ error }));
    child.on("close", (code, signal) => finish({ code, signal }));
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
      const text = textFromEvent(event);
      if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof text === "string") {
        final = text.trim();
      }
      if (event.type === "response_item" && event.payload?.type === "message" && event.payload?.phase === "final_answer") {
        final = text.trim();
      }
      if (event.type === "event_msg" && event.payload?.type === "agent_message" && event.payload?.phase === "final_answer") {
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

export function extractProgressSummary(stdout) {
  const progress = [];
  for (const line of String(stdout || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const summary = summarizeCodexEvent(JSON.parse(line));
      if (summary && progress[progress.length - 1] !== summary) progress.push(summary);
    } catch {
      // Ignore non-JSON output.
    }
  }
  return progress.join("\n");
}

export function summarizeCodexEvent(event) {
  const type = String(event?.type || event?.method || "");
  const params = event?.params || {};
  const item = event?.item || params.item || event?.payload || params;
  const itemType = String(item?.type || "");

  if (/turn[./]started/i.test(type)) return "Started working on the Feishu/Lark message.";
  if (/turn[./]completed/i.test(type)) return formatUsage(event?.usage || params.turn?.usage || params.usage);

  if (itemType === "message" && item.role === "assistant") {
    if (item.phase === "final_answer") return "";
    const text = textFromEvent(event);
    return text ? `Codex: ${oneLine(text, 900)}` : "";
  }

  if (itemType === "agent_message" || /agentMessage/i.test(type)) {
    if (item.phase === "final_answer") return "";
    return item.message ? `Codex: ${oneLine(item.message, 900)}` : "";
  }

  const command = commandFromEvent(event, item);
  if (command) {
    const output = item.aggregated_output || item.output || item.stdout || item.stderr || event.output || "";
    return [`Ran command: ${oneLine(command, 220)}`, output ? `Output: ${oneLine(output, 700)}` : ""]
      .filter(Boolean)
      .join("\n");
  }

  const files = filesFromEvent(event, item);
  if (files.length) return `Updated files: ${files.slice(0, 8).join(", ")}${files.length > 8 ? " ..." : ""}`;

  const toolName = item.name || item.tool_name || item.toolName || event.tool_name || event.toolName;
  if (toolName && /tool|mcp/i.test(`${type} ${itemType}`)) return `Used tool: ${toolName}`;

  if (itemType === "custom_tool_call_output") {
    const output = item.output || event.output || "";
    return output ? `Tool output: ${oneLine(output, 900)}` : "";
  }

  if (/error|failed/i.test(type)) {
    const message = event.message || event.error?.message || event.error || item.message || "Codex reported an error.";
    return `Error: ${oneLine(message, 700)}`;
  }

  return "";
}

function createProgressNotifier({ command, config, notify }) {
  const handoff = config.handoff || {};
  if (handoff.notifyProgress === false || command.mode !== "thread_handoff") return async () => {};
  const minIntervalMs = Number(handoff.progressIntervalMs || 2500);
  const maxMessages = Number(handoff.maxProgressMessages || 5);
  let sent = 0;
  let lastAt = 0;
  let lastText = "";

  return async (_event, summary) => {
    if (!summary || summary === lastText || sent >= maxMessages) return;
    const now = Date.now();
    if (sent > 0 && now - lastAt < minIntervalMs && !isImportantProgress(summary)) return;
    sent += 1;
    lastAt = now;
    lastText = summary;
    await notify(formatProgress(command, summary));
  };
}

function isImportantProgress(summary) {
  return /^(Ran command|Updated files|Used tool|Error:)/.test(summary);
}

function formatUsage(usage) {
  if (!usage) return "Codex turn completed.";
  const input = usage.input_tokens ?? usage.inputTokens;
  const output = usage.output_tokens ?? usage.outputTokens;
  if (input || output) return `Codex turn completed. Tokens: input=${input || 0} output=${output || 0}`;
  return "Codex turn completed.";
}

function commandFromEvent(event, item) {
  if (item?.command) return item.command;
  if (item?.raw_command) return item.raw_command;
  if (item?.action?.command) return item.action.command;
  if (Array.isArray(item?.argv)) return item.argv.join(" ");
  if (event?.command) return event.command;
  if (/command/i.test(`${event?.type || ""} ${item?.type || ""}`)) return item?.cmd || item?.name || "";
  return "";
}

function filesFromEvent(event, item) {
  const values = [];
  for (const source of [event?.files, item?.files, item?.changes, item?.edits, item?.updates]) {
    if (!source) continue;
    for (const entry of Array.isArray(source) ? source : Object.values(source)) {
      if (typeof entry === "string") values.push(entry);
      else if (entry?.path) values.push(entry.path);
      else if (entry?.file) values.push(entry.file);
      else if (entry?.filePath) values.push(entry.filePath);
    }
  }
  const patchInput = item?.input || event?.input || "";
  if (typeof patchInput === "string" && patchInput.includes("*** Begin Patch")) {
    for (const match of patchInput.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
      values.push(match[1].trim());
    }
  }
  const single = item?.path || item?.file || item?.filePath || event?.path;
  if (single) values.push(single);
  return [...new Set(values.map((value) => String(value)).filter(Boolean))];
}

function textFromEvent(event) {
  const payload = event?.payload || {};
  if (typeof payload.message === "string") return payload.message;
  if (Array.isArray(payload.content)) {
    return payload.content
      .map((part) => part?.text || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  const item = event?.item || {};
  if (typeof item.text === "string") return item.text;
  return event?.message || event?.text || event?.content || event?.delta || "";
}

function oneLine(value, max) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function tail(value, max = 3000) {
  const text = String(value || "");
  return text.length > max ? text.slice(-max) : text;
}

function appendLimited(base, chunk, max = 1024 * 1024 * 8) {
  const next = `${base || ""}${chunk || ""}`;
  return next.length > max ? next.slice(-max) : next;
}
