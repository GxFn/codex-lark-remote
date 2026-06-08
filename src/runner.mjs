import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { nowIso, safeFileName, worktreeRoot } from "./config.mjs";
import { readHandoff } from "./handoff.mjs";
import { resolveIntentSessionLanguage } from "./intent-state.mjs";
import { formatFinal, formatHandoffSessionBusy, formatProgress } from "./presenter.mjs";
import { buildRunnerPrompt } from "./prompt.mjs";
import { detectSessionStatus } from "./takeover.mjs";

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
      const language = await resolveCommandLanguage(this.config, command);
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
          error: result.exitCode === 0 ? "" : formatRunnerError(result, { language }),
          completedAt: nowIso(),
        },
        result.exitCode === 0 ? "codex_completed" : "codex_failed",
      );
      await this.#notify(updated, formatFinal(updated));
    } catch (error) {
      const language = await resolveCommandLanguage(this.config, command);
      const formattedError = formatPermissionBoundaryNotice(error.message, { language }) || error.message;
      const failed = await this.queue.update(
        command.id,
        {
          status: "failed",
          error: formattedError,
          completedAt: nowIso(),
        },
        "runner_error",
      );
      await this.#notify(failed || command, formatFinal(failed || {
        ...command,
        status: "failed",
        error: formattedError,
      }));
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
      eventOptions: {
        showCommands: this.config.handoff?.showCommands === true,
        language: await resolveCommandLanguage(this.config, command),
      },
    });
  }

  async #runHandoffOne(command) {
    try {
      if (await this.#isCancelled(command.id)) return;
      const busy = await detectBusyHandoffSession(this.config, command);
      if (busy) {
        const language = await resolveCommandLanguage(this.config, command);
        const message = formatHandoffSessionBusy(command, busy, { language });
        const cancelled = await this.queue.update(
          command.id,
          {
            status: "cancelled",
            error: message,
            completedAt: nowIso(),
          },
          "handoff_session_busy",
        );
        await this.#notify(cancelled || command, message);
        return;
      }
      if (shouldNotifyStarted(this.config, command)) {
        const language = await resolveCommandLanguage(this.config, command);
        await this.#notify(command, formatHandoffStarted({ language, dispatchTarget: command.dispatchTarget }));
      }
      const progressNotifier = createProgressNotifier({
        command,
        config: this.config,
        notify: (text) => this.#notify(command, text),
      });
      const prompt = buildHandoffPrompt(command, { promptStyle: this.config.handoff?.promptStyle || "direct" });
      const result = await this.#runCodexResume(command, prompt, { onEvent: progressNotifier });
      if (await this.#isCancelled(command.id)) return;
      const language = await resolveCommandLanguage(this.config, command);
      const diffSummary = command.projectRoot ? await gitMaybe(["-C", command.projectRoot, "diff", "--stat"]) : "";

      const updated = await this.queue.update(
        command.id,
        {
          status: result.exitCode === 0 ? "completed" : "failed",
          result: result.finalMessage || result.stdoutTail || "",
          progressSummary: result.progressSummary || "",
          diffSummary: diffSummary.trim(),
          testSummary: "",
          error: result.exitCode === 0 ? "" : formatRunnerError(result, { language }),
          completedAt: nowIso(),
        },
        result.exitCode === 0 ? "codex_resume_completed" : "codex_resume_failed",
      );
      await this.#notify(updated, formatFinal(updated));
    } catch (error) {
      if (await this.#isCancelled(command.id)) return;
      const language = await resolveCommandLanguage(this.config, command);
      const formattedError = formatPermissionBoundaryNotice(error.message, { language }) || error.message;
      const failed = await this.queue.update(
        command.id,
        {
          status: "failed",
          error: formattedError,
          completedAt: nowIso(),
        },
        "runner_error",
      );
      await this.#notify(failed || command, formatFinal(failed || {
        ...command,
        status: "failed",
        error: formattedError,
      }));
    }
  }

  async #runCodexResume(command, prompt, { onEvent } = {}) {
    const runner = this.config.runner || {};
    const resultsDir = path.join(this.config.dataDir, "results");
    await fs.mkdir(resultsDir, { recursive: true });
    const outputFile = path.join(resultsDir, `${safeFileName(command.id)}.txt`);
    const language = await resolveCommandLanguage(this.config, command);
    const args = buildCodexResumeArgs({
      runner,
      threadId: command.codexSessionId,
      prompt,
      outputFile,
      cwd: command.projectRoot,
    });
    const sessionWatcher = createSessionProgressWatcher({
      sessionPath: command.codexSessionPath,
      onEvent,
      eventOptions: {
        showCommands: this.config.handoff?.showCommands === true,
        language,
      },
      includeUserPrompts: true,
      userPromptText: (_event, promptText) => handoffVisibleUserPrompt(promptText, { command, submittedPrompt: prompt }),
    });
    await sessionWatcher.start();
    let result;
    try {
      result = await runProcess(runner.codexPath || "codex", args, {
        timeoutMs: Number(runner.timeoutMs || 30 * 60 * 1000),
        cwd: command.projectRoot || undefined,
        onEvent,
        eventOptions: {
          showCommands: this.config.handoff?.showCommands === true,
          language,
        },
      });
    } finally {
      await sessionWatcher.stop();
    }
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
    if (!(await this.#shouldNotify(command))) return;
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

  async #shouldNotify(command) {
    if (command.mode !== "thread_handoff") return true;
    if (!this.config.dataDir) return false;
    try {
      const handoff = await readHandoff({ dataDir: this.config.dataDir });
      return Boolean(handoff?.active && handoff.threadId === command.codexSessionId);
    } catch {
      return false;
    }
  }

  async #isCancelled(commandId) {
    try {
      const latest = await this.queue.get(commandId);
      return latest?.status === "cancelled";
    } catch {
      return false;
    }
  }
}

function shouldNotifyStarted(config, command) {
  if (command?.notifyStarted === true) return true;
  return config?.handoff?.notifyStarted !== false;
}

function formatHandoffStarted(options = {}) {
  if (options.dispatchTarget?.threadId) {
    return options.language === "en"
      ? "Received. The control Codex window is preparing thread dispatch."
      : "已收到，控制 Codex 窗口正在准备线程派发。";
  }
  return options.language === "en"
    ? "Received. The control Codex window is handling this message."
    : "已收到，控制 Codex 窗口正在处理这条消息。";
}

async function detectBusyHandoffSession(config = {}, command = {}) {
  if (command.mode !== "thread_handoff" || !command.codexSessionPath) return null;
  const status = await detectSessionStatus(command.codexSessionPath, {
    idleDebounceMs: config.handoff?.idleDebounceMs ?? config.takeover?.idleDebounceMs,
  });
  return status.status === "running" ? status : null;
}

async function resolveCommandLanguage(config = {}, command = {}) {
  if (!config.dataDir || !command.chatIdHash) return config.intent?.language === "en" ? "en" : "zh";
  try {
    return await resolveIntentSessionLanguage({
      dataDir: config.dataDir,
      event: { chatIdHash: command.chatIdHash },
      config,
    });
  } catch {
    return config.intent?.language === "en" ? "en" : "zh";
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
  if (command.dispatchTarget?.threadId) {
    return buildThreadDispatchPrompt(command);
  }

  if (promptStyle === "direct") {
    const prompt = command.prompt || "";
    return command.includeRemoteNote === true ? withHandoffPermissionNote(prompt, command) : prompt;
  }

  return [
    "[Codex Lark Remote handoff]",
    "The user is sending this message from Feishu/Lark to continue the current Codex conversation.",
    `Sender: ${command.userName || "lark_user"}${command.userIdHash ? ` (${command.userIdHash})` : ""}`,
    "",
    "Permission boundary:",
    "Feishu/Lark cannot click native Codex Desktop permission dialogs. If approval, sandbox escalation, network/install permission, or another UI permission is required, do not wait silently. Reply with a concise prompt explaining what permission is needed and whether the user must approve it in Codex Desktop or can provide explicit text consent in Feishu/Lark.",
    "",
    "User message:",
    command.prompt,
  ].join("\n");
}

function buildThreadDispatchPrompt(command) {
  const target = command.dispatchTarget || {};
  return [
    "[Codex Lark Remote thread dispatch]",
    "You are the dedicated Lark Remote control Codex window. JavaScript has not sent this message to the target thread; it only delivered this dispatch request to you.",
    "",
    "Dispatch boundary:",
    "- Use the Lark Remote Control Window skill if it is available.",
    "- Only this Codex control window may perform real thread dispatch with available Codex host thread tools.",
    "- Lark Remote JavaScript intercepted only explicit bridge/control keywords before this reached you. Treat the Feishu/Lark text below as the source of truth and decide whether to answer, use Lark Remote MCP tools, or dispatch to the selected target.",
    "- Lark Remote is acting as the takeover side. If the target thread is busy, treat this as a higher-priority dispatch/interrupt request and perform normal delivery instead of failing because of busy status.",
    "- If the host thread tool is unavailable, the target thread cannot be addressed, or readback cannot be verified, fail closed and tell the Feishu/Lark user what is blocked.",
    "- Do not claim delivery merely because this dispatch request reached the control window.",
    "- Keep the visible target prompt compact if you send one.",
    "- Keep the final reply concise and suitable for Feishu/Lark.",
    "",
    "Lark Remote command:",
    `- remoteCommandId: ${command.id || ""}`,
    "- Use this id with Lark Remote MCP tools when they ask for remoteCommandId.",
    "- Do not repeat internal ids in the final Feishu/Lark reply unless the user asks for diagnostics.",
    "",
    "Selected target session:",
    `- title: ${target.name || "Untitled Codex chat"}`,
    `- threadId: ${target.threadId || ""}`,
    target.cwd ? `- cwd: ${target.cwd}` : "",
    target.status ? `- status: ${target.status}${target.statusReason ? ` (${target.statusReason})` : ""}` : "",
    target.threadPath ? `- localSessionPath: ${target.threadPath}` : "",
    "",
    "Sender:",
    `${command.userName || "lark_user"}${command.userIdHash ? ` (${command.userIdHash})` : ""}`,
    "",
    "Permission boundary:",
    "Feishu/Lark cannot click native Codex Desktop permission dialogs. If approval, sandbox escalation, network/install permission, or another UI permission is required, do not wait silently. Reply with a concise prompt explaining what permission is needed and whether the user must approve it in Codex Desktop or can provide explicit text consent in Feishu/Lark.",
    "",
    "Feishu/Lark user message to dispatch:",
    command.prompt || "",
  ].filter((line) => line !== "").join("\n");
}

function withHandoffPermissionNote(prompt, command = {}) {
  return [
    prompt,
    "",
    "<codex_lark_remote_note>",
    `remoteCommandId: ${command.id || ""}`,
    "Use the Lark Remote Control Window skill if it is available.",
    "Use remoteCommandId with Lark Remote MCP tools when they need to anchor actions such as observation to the current Feishu/Lark message. Do not repeat internal ids in the final Feishu/Lark reply unless the user asks for diagnostics.",
    "Lark Remote JavaScript intercepted only explicit bridge/control keywords before this reached you. For ordinary Feishu/Lark text, use your Codex agent abilities, available skills, and available MCP tools to decide whether to answer directly, inspect Lark Remote status, choose targets, or perform thread dispatch.",
    "This message came from Feishu/Lark remote takeover. Feishu/Lark cannot click native Codex Desktop permission dialogs. If approval, sandbox escalation, network/install permission, or another UI permission is required, do not wait silently. Reply with a concise prompt explaining what permission is needed and whether the user must approve it in Codex Desktop or can provide explicit text consent in Feishu/Lark.",
    "</codex_lark_remote_note>",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeDelivery(delivery) {
  if (delivery === true) return { ok: true };
  if (delivery === false || !delivery) return { ok: false, error: "Lark reply returned false" };
  return delivery;
}

function formatRunnerError(result, options = {}) {
  const raw = [result.stderrTail, result.stdoutTail].filter(Boolean).join("\n");
  return formatPermissionBoundaryNotice(raw, options) || result.stderrTail || `Codex exited with ${result.exitCode}`;
}

async function runProcess(command, args, { timeoutMs, cwd, onEvent, eventOptions = {} }) {
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
        progressSummary: progress.join("\n"),
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
        const summary = summarizeCodexEvent(event, eventOptions);
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

export function extractProgressSummary(stdout, options = {}) {
  const progress = [];
  for (const line of String(stdout || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const summary = summarizeCodexEvent(JSON.parse(line), options);
      if (summary && progress[progress.length - 1] !== summary) progress.push(summary);
    } catch {
      // Ignore non-JSON output.
    }
  }
  return progress.join("\n");
}

export async function readSessionLastTurnSummary(sessionPath, options = {}) {
  const text = await readFileTail(sessionPath, Number(options.maxBytes || 512 * 1024));
  const records = parseJsonRecords(text);
  const turn = lastCompletedTurn(records);
  if (!turn.length) return null;
  const finalMessage = extractLastAssistantFinalMessage(turn);
  const progress = [];
  for (const event of turn) {
    const summary = summarizeCodexEvent(event, options);
    if (!summary || /^Codex turn completed\b/i.test(summary)) continue;
    if (progress[progress.length - 1] !== summary) progress.push(summary);
  }
  if (!finalMessage && !progress.length) return null;
  return {
    finalMessage,
    progressSummary: progress.join("\n"),
  };
}

export function summarizeCodexEvent(event, { showCommands = false } = {}) {
  const type = String(event?.type || event?.method || "");
  const params = event?.params || {};
  const item = event?.item || params.item || event?.payload || params;
  const itemType = String(item?.type || "");

  if (/turn[./]started/i.test(type)) return "";
  if (/turn[./]completed/i.test(type)) return formatUsage(event?.usage || params.turn?.usage || params.usage);

  if (itemType === "message" && item.role === "assistant") {
    if (item.phase === "final_answer") return "";
    const text = textFromEvent(event);
    return text ? progressText(text) : "";
  }

  if (itemType === "agent_message" || /agentMessage/i.test(type)) {
    if (item.phase === "final_answer") return "";
    return item.message ? progressText(item.message) : "";
  }

  const command = commandFromEvent(event, item);
  if (command) {
    const output = item.aggregated_output || item.output || item.stdout || item.stderr || event.output || "";
    const permissionNotice = commandFailed(event, item) ? formatPermissionBoundaryNotice(output) : "";
    if (permissionNotice) return permissionNotice;
    const commandSummary = summarizeCommand(command);
    if (!showCommands && !commandSummary.warning) return "";
    const summarizedOutput = showCommands ? summarizeCommandOutput(command, output) : "";
    return [
      `Ran command:\n${commandSummary.command}`,
      commandSummary.warning ? `Warning: ${commandSummary.warning}` : "",
      summarizedOutput ? `Output:\n${summarizedOutput}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const files = filesFromEvent(event, item);
  if (files.length) return `Updated files: ${files.slice(0, 8).join(", ")}${files.length > 8 ? " ..." : ""}`;

  const toolName = item.name || item.tool_name || item.toolName || event.tool_name || event.toolName;
  if (toolName && /tool|mcp/i.test(`${type} ${itemType}`)) return `Used tool: ${toolName}`;

  if (itemType === "custom_tool_call_output") {
    const output = item.output || event.output || "";
    if (!errorLikeEvent(event, item)) return "";
    const permissionNotice = formatPermissionBoundaryNotice(output);
    if (permissionNotice) return permissionNotice;
    return output ? `Tool output:\n${progressText(output)}` : "";
  }

  if (/error|failed/i.test(`${type} ${itemType}`)) {
    const message = event.message || event.error?.message || event.error || item.message || "Codex reported an error.";
    const permissionNotice = formatPermissionBoundaryNotice(message);
    if (permissionNotice) return permissionNotice;
    return `Error:\n${progressText(message)}`;
  }

  return "";
}

export function summarizeSessionProgressEvent(event, options = {}) {
  const type = String(event?.type || event?.method || "");
  const params = event?.params || {};
  const item = event?.item || params.item || event?.payload || params;
  const itemType = String(item?.type || "");
  const isAssistantMessage = itemType === "agent_message"
    || (itemType === "message" && item.role === "assistant")
    || /agentMessage/i.test(type);
  if (!isAssistantMessage || item.phase === "final_answer") return "";
  return summarizeCodexEvent(event, options);
}

export function summarizeSessionUserPromptEvent(event, options = {}) {
  const prompt = userPromptFromEvent(event);
  if (!prompt) return "";
  return formatSessionUserPrompt(prompt, options);
}

export function createSessionProgressWatcher({
  sessionPath,
  onEvent,
  intervalMs = 500,
  eventOptions = {},
  includeUserPrompts = false,
  userPromptText,
} = {}) {
  let offset = 0;
  let buffer = "";
  let timer = null;
  let reading = false;
  let chain = Promise.resolve();
  let lastSummary = "";

  const readNew = async () => {
    if (reading || !sessionPath || !onEvent) return;
    reading = true;
    try {
      const handle = await fs.open(sessionPath, "r");
      try {
        const stat = await handle.stat();
        if (stat.size <= offset) return;
        const chunk = Buffer.alloc(stat.size - offset);
        await handle.read(chunk, 0, chunk.length, offset);
        offset = stat.size;
        buffer += chunk.toString("utf8");
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) handleSessionLine(line);
      } finally {
        await handle.close();
      }
    } catch {
      // Session files are best-effort progress sources. stdout remains primary.
    } finally {
      reading = false;
    }
  };

  const handleSessionLine = (line) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      const summary = summarizeSessionProgressEvent(event, eventOptions)
        || summarizeWatcherUserPrompt(event, { eventOptions, includeUserPrompts, userPromptText });
      if (!summary || summary === lastSummary) return;
      lastSummary = summary;
      chain = chain.then(() => onEvent(event, summary)).catch(() => {});
    } catch {
      // Ignore partial or non-JSON session lines.
    }
  };

  return {
    async start() {
      if (!sessionPath || !onEvent) return;
      try {
        offset = (await fs.stat(sessionPath)).size;
      } catch {
        offset = 0;
      }
      timer = setInterval(readNew, intervalMs);
      timer.unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await readNew();
      await chain.catch(() => {});
    },
  };
}

function summarizeWatcherUserPrompt(event, { eventOptions = {}, includeUserPrompts = false, userPromptText } = {}) {
  if (!includeUserPrompts) return "";
  const prompt = userPromptFromEvent(event);
  if (!prompt) return "";
  const visible = typeof userPromptText === "function" ? userPromptText(event, prompt) : prompt;
  return visible ? formatSessionUserPrompt(visible, eventOptions) : "";
}

function createProgressNotifier({ command, config, notify }) {
  const handoff = config.handoff || {};
  if (handoff.notifyProgress === false || command.mode !== "thread_handoff") return async () => {};
  let lastText = "";

  return async (_event, summary) => {
    if (!summary || summary === lastText) return;
    lastText = summary;
    await notify(formatProgress(command, summary));
  };
}

function handoffVisibleUserPrompt(promptText, { command = {}, submittedPrompt = "" } = {}) {
  const text = progressText(promptText);
  if (!text) return "";
  const submitted = isSubmittedHandoffPrompt(text, { command, submittedPrompt });
  if (isFeishuLarkSource(command)) return submitted ? "" : text;
  if (submitted) return command.prompt || extractThreadDispatchUserMessage(text) || text;
  return text;
}

function isFeishuLarkSource(command = {}) {
  const source = String(command.source || "lark").trim().toLowerCase();
  return !source || source === "lark" || source === "feishu" || source === "feishu/lark";
}

function isSubmittedHandoffPrompt(text, { command = {}, submittedPrompt = "" } = {}) {
  const normalized = comparablePrompt(text);
  const submitted = comparablePrompt(submittedPrompt);
  const raw = comparablePrompt(command.prompt || "");
  return Boolean(
    (submitted && normalized === submitted)
    || (raw && normalized === raw)
    || /\[Codex Lark Remote (?:handoff|thread dispatch)\]/i.test(text)
    || /<codex_lark_remote_note>/i.test(text)
    || /Feishu\/Lark user message to dispatch:/i.test(text)
  );
}

function extractThreadDispatchUserMessage(text) {
  const match = String(text || "").match(/Feishu\/Lark user message to dispatch:\s*([\s\S]+)$/i);
  return match?.[1]?.trim() || "";
}

function comparablePrompt(text) {
  return progressText(text).replace(/\s+/g, " ").trim();
}

function formatUsage(usage) {
  if (!usage) return "Codex turn completed.";
  const input = usage.input_tokens ?? usage.inputTokens;
  const output = usage.output_tokens ?? usage.outputTokens;
  if (input || output) return `Codex turn completed. Tokens: input=${input || 0} output=${output || 0}`;
  return "Codex turn completed.";
}

export function formatPermissionBoundaryNotice(value, options = {}) {
  const reason = classifyPermissionBoundary(value);
  if (!reason) return "";
  const language = options.language === "zh" ? "zh" : "en";
  const details = oneLineCommandOutput(redactSensitiveText(progressText(value)), 280);
  if (language === "zh") {
    return [
      "需要权限确认",
      "飞书/Lark 接管不能直接点击 Codex Desktop 的原生权限弹窗。",
      `原因：${localizePermissionReason(reason, language)}`,
      details ? `详情：${details}` : "",
      "",
      "如果 Mac 上有 Codex 权限弹窗，请回到 Codex Desktop 批准。若只需要文字授权，可以直接在飞书/Lark 里明确回复允许的操作。",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "Permission needed",
    "Feishu/Lark takeover cannot click Codex Desktop permission dialogs directly.",
    `Reason: ${reason}`,
    details ? `Details: ${details}` : "",
    "",
    "If a Codex permission dialog is open, approve it on the Mac. If text consent is enough, reply in Feishu/Lark with explicit approval and what to allow.",
  ]
    .filter(Boolean)
    .join("\n");
}

function classifyPermissionBoundary(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (looksLikeSourceInspectionSummary(text)) return "";
  const checks = [
    [/\b(unacceptable risk|auto[- ]?review.*rejected|rejected due to unacceptable risk|must be denied)\b/i, "Codex security review blocked the action."],
    [/\b(network access is restricted|network access (?:denied|blocked|restricted)|network is (?:denied|blocked|restricted)|dns (?:resolution )?(?:denied|blocked|restricted)|host resolution (?:denied|blocked|restricted)|dependency download failed)\b/i, "Network or dependency access needs approval."],
    [/\b(approval (?:is )?required|approval required|requires? (?:user )?approval|requires approval in Codex Desktop|permission dialog|ask-for-approval|escalat(?:e|ion) (?:required|request|needed)|needs approval)\b/i, "Codex approval is required."],
    [/\b(operation not permitted|not permitted|permission denied|eacces|eperm|access denied)\b/i, "The sandbox or operating system denied the operation."],
    [/\b(read[- ]?only sandbox|outside (?:the )?(?:workspace|sandbox)|workspace-write|writable roots?|not inside a trusted directory|trusted directory|skip-git-repo-check)\b/i, "The current sandbox or trust policy blocked the workspace action."],
    [/\btool call (?:error: )?(?:was )?(?:rejected|denied|blocked)\b/i, "A tool permission boundary interrupted the turn."],
  ];
  return checks.find(([pattern]) => pattern.test(text))?.[1] || "";
}

function looksLikeSourceInspectionSummary(text) {
  if (!/\[\d+\s+lines,\s+\d+\s+chars\]/i.test(text)) return false;
  return !/\b(unacceptable risk|network access is restricted|approval (?:is )?required|approval required|requires approval in Codex Desktop|permission denied|operation not permitted|tool call (?:error: )?(?:was )?(?:rejected|denied|blocked))\b/i.test(text);
}

function localizePermissionReason(reason, language) {
  if (language !== "zh") return reason;
  const map = new Map([
    ["Codex security review blocked the action.", "Codex 安全审查阻止了这个操作。"],
    ["Network or dependency access needs approval.", "联网或依赖下载需要批准。"],
    ["Codex approval is required.", "需要 Codex 权限批准。"],
    ["The sandbox or operating system denied the operation.", "沙箱或操作系统拒绝了这个操作。"],
    ["The current sandbox or trust policy blocked the workspace action.", "当前沙箱或信任策略阻止了这个工作区操作。"],
    ["A tool permission boundary interrupted the turn.", "工具权限边界中断了这一轮执行。"],
  ]);
  return map.get(reason) || reason;
}

function commandFailed(event, item) {
  const exitCode = item?.exit_code ?? item?.exitCode ?? event?.exit_code ?? event?.exitCode;
  if (typeof exitCode === "number") return exitCode !== 0;
  if (typeof exitCode === "string" && exitCode.trim()) return exitCode !== "0";
  return /\b(failed|error|cancelled|timed_out|timeout)\b/i.test(`${event?.status || ""} ${item?.status || ""}`);
}

function errorLikeEvent(event, item) {
  if (item?.is_error === true || item?.error === true || event?.is_error === true || event?.error === true) return true;
  return /\b(error|failed|rejected|denied|blocked)\b/i.test(`${event?.type || ""} ${item?.type || ""} ${event?.status || ""} ${item?.status || ""}`);
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
  const item = event?.item || event?.params?.item || payload.item || {};
  if (typeof item.text === "string") return item.text;
  if (typeof item.message === "string") return item.message;
  return event?.message || event?.text || event?.content || event?.delta || "";
}

function userPromptFromEvent(event) {
  const payload = event?.payload || {};
  const item = event?.item || event?.params?.item || payload.item || {};
  const role = String(payload.role || item.role || event?.role || "").toLowerCase();
  const eventType = String(event?.type || event?.method || "");
  const payloadType = String(payload.type || "");
  const itemType = String(item.type || "");
  const isUser = role === "user"
    || payloadType === "user_message"
    || itemType === "user_message"
    || /user_message/i.test(`${eventType} ${payloadType} ${itemType}`);
  if (!isUser) return "";
  return progressText(textFromEvent(event));
}

function formatSessionUserPrompt(prompt, options = {}) {
  const language = options.language === "en" ? "en" : "zh";
  const max = Number(options.maxUserPromptChars || 1600);
  const text = clipUserPrompt(redactSensitiveText(progressText(prompt)), max, language);
  if (!text) return "";
  return language === "en"
    ? `User prompt:\n${text}`
    : `用户提示：\n${text}`;
}

function clipUserPrompt(text, max, language) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (!Number.isFinite(max) || max <= 0 || value.length <= max) return value;
  const suffix = language === "en" ? "\n...[truncated]" : "\n...[已截断]";
  const budget = Math.max(80, max - suffix.length);
  return `${value.slice(0, budget).trimEnd()}${suffix}`;
}

async function readFileTail(filePath, maxBytes) {
  if (!filePath) return "";
  try {
    const stat = await fs.stat(filePath);
    const length = Math.min(stat.size, Math.max(1024, maxBytes));
    const start = Math.max(0, stat.size - length);
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      return buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

function parseJsonRecords(text) {
  const records = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Tail reads can start in the middle of a JSONL record.
    }
  }
  return records;
}

function lastCompletedTurn(records) {
  const completedIndex = findLastIndex(records, isTurnCompletedEvent);
  if (completedIndex < 0) return [];
  const startIndex = findLastIndex(records.slice(0, completedIndex + 1), isTurnStartedEvent);
  if (startIndex >= 0) return records.slice(startIndex, completedIndex + 1);
  const previousCompletedIndex = findLastIndex(records.slice(0, completedIndex), isTurnCompletedEvent);
  return records.slice(previousCompletedIndex + 1, completedIndex + 1);
}

function extractLastAssistantFinalMessage(records) {
  let final = "";
  for (const event of records) {
    const text = textFromEvent(event);
    if (isAssistantFinalEvent(event) && typeof text === "string" && text.trim()) {
      final = text.trim();
    }
  }
  return final;
}

function isTurnStartedEvent(event) {
  const itemType = String((event?.item || event?.params?.item || event?.payload || {}).type || "");
  return itemType === "task_started"
    || /(?:turn|response)[./_-]?started/i.test(`${event?.type || ""} ${event?.method || ""} ${event?.payload?.phase || ""}`);
}

function isTurnCompletedEvent(event) {
  const itemType = String((event?.item || event?.params?.item || event?.payload || {}).type || "");
  return itemType === "task_complete"
    || /(?:turn|response)[./_-]?completed/i.test(`${event?.type || ""} ${event?.method || ""} ${event?.payload?.phase || ""}`);
}

function isAssistantFinalEvent(event) {
  const params = event?.params || {};
  const payload = event?.payload || params || {};
  const item = event?.item || params.item || payload.item || {};
  const type = String(event?.type || event?.method || "");
  const itemType = String(item.type || payload.type || "");
  const phase = String(item.phase || payload.phase || "");
  const role = String(item.role || payload.role || "");
  return (
    (itemType === "agent_message" && (phase === "final_answer" || type === "item.completed"))
    || (itemType === "message" && role === "assistant" && phase === "final_answer")
    || /final_answer/i.test(`${type} ${phase}`)
  );
}

function findLastIndex(items, predicate) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index], index, items)) return index;
  }
  return -1;
}

function progressText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function redactSensitiveText(value) {
  return String(value || "")
    .replace(/([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*=)(["']?)[^\s"']+/gi, "$1$2[redacted]")
    .replace(/(--(?:token|secret|password|api-key|access-key|private-key|app-secret)\s+)([^\s]+)/gi, "$1[redacted]")
    .replace(/\b(sk-(?:proj-)?[A-Za-z0-9_-]{12,})\b/g, "[redacted-secret]")
    .replace(/\b(ghp_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/g, "[redacted-secret]")
    .replace(/\b(xox[baprs]-[A-Za-z0-9-]{12,})\b/g, "[redacted-secret]")
    .replace(/\b(AKIA[0-9A-Z]{12,})\b/g, "[redacted-secret]")
    .replace(/(https?:\/\/[^:\s/@]+:)[^@\s]+(@)/g, "$1[redacted]$2");
}

function summarizeCommand(command) {
  const text = redactSensitiveText(progressText(command));
  return {
    command: text,
    warning: classifyCommandRisk(text),
  };
}

function classifyCommandRisk(command) {
  const value = String(command || "").replace(/\s+/g, " ").trim();
  const checks = [
    [/\b(?:sudo|doas)\b/i, "privileged command"],
    [/\b(?:rm|rmdir|unlink)\b/i, "file removal"],
    [/\b(?:mv|cp)\b[^|;&]*\s(?:\/|~\/|\.\.\/)/i, "filesystem write"],
    [/\b(?:chmod|chown|chgrp)\b/i, "permission or ownership change"],
    [/\b(?:kill|killall|pkill)\b/i, "process termination"],
    [/\bgit\s+(?:reset\s+--hard|clean\b|checkout\s+--|restore\b.*\s--source=)/i, "destructive git operation"],
    [/\bgit\s+push\b/i, "remote git push"],
    [/\b(?:npm|pnpm|yarn)\s+(?:publish|unpublish)\b/i, "package registry publish"],
    [/\b(?:curl|wget)\b.*\|\s*(?:sh|bash|zsh|python|ruby|node)\b/i, "downloaded script execution"],
    [/\bdd\b.*\bof=/i, "raw disk write"],
    [/\b(?:diskutil|mkfs|mount|umount)\b/i, "disk operation"],
    [/\bdefaults\s+write\b/i, "system settings write"],
    [/\bsecurity\s+(?:add|delete|set|unlock|find)-/i, "keychain operation"],
  ];
  const match = checks.find(([pattern]) => pattern.test(value));
  return match ? `potentially risky command: ${match[1]}` : "";
}

function summarizeCommandOutput(command, output) {
  const text = progressText(output);
  if (!text) return "";
  if (isCodeInspectionCommand(command) && !looksLikeHighSignalOutput(command, text)) {
    return `[omitted source/code output: ${lineCount(text)} lines, ${text.length} chars]`;
  }
  return oneLineCommandOutput(text);
}

function isCodeInspectionCommand(command) {
  const value = String(command || "");
  return /\b(cat|nl|sed|awk|less|more|head|tail|grep)\b/.test(value)
    || (/\brg\b/.test(value) && !/(^|\s)(--files|-l|--files-with-matches)(\s|$)/.test(value));
}

function looksLikeHighSignalOutput(command, output) {
  const value = `${command}\n${output}`;
  return /\b(test|pytest|vitest|jest|mocha|node --test|swift test|xcodebuild|npm test|pnpm test|yarn test)\b/i.test(value)
    || /\b(git diff|git status|git log|git show|git grep)\b/i.test(value)
    || /\b(error|failed|failure|exception|traceback|panic|fatal|warning|passed|ok \d+|not ok)\b/i.test(output);
}

function oneLineCommandOutput(text, max = 360) {
  const lines = String(text || "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "";
  const selected = lines.find(isHighSignalLine) || lines[0];
  const oneLine = selected.replace(/\s+/g, " ").trim();
  const omitted = lines.length > 1 || text.length > oneLine.length;
  const suffix = omitted ? ` [${lineCount(text)} lines, ${text.length} chars]` : "";
  const budget = Math.max(20, max - suffix.length);
  const clipped = oneLine.length > budget ? `${oneLine.slice(0, budget - 3)}...` : oneLine;
  return `${clipped}${suffix}`;
}

function isHighSignalLine(line) {
  return /\b(error|failed|failure|exception|traceback|panic|fatal|warning|passed|ok \d+|not ok|# pass|# fail|build succeeded|build failed)\b/i.test(line);
}

function lineCount(text) {
  return String(text || "").split(/\n/).length;
}

function firstLines(text, maxLines) {
  return String(text || "")
    .split(/\n/)
    .slice(0, maxLines)
    .join("\n")
    .trim();
}

function tail(value, max = 3000) {
  const text = String(value || "");
  return text.length > max ? text.slice(-max) : text;
}

function appendLimited(base, chunk, max = 1024 * 1024 * 8) {
  const next = `${base || ""}${chunk || ""}`;
  return next.length > max ? next.slice(-max) : next;
}
