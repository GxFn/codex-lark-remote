import { truncateForLark } from "./notifier.mjs";

export function formatHelp() {
  return [
    "Codex Lark Remote",
    "",
    "Examples:",
    "[repo] fix the failing test",
    "> force a coding task",
    "/codex whoami",
    "/codex status",
    "/codex status rcmd_xxx",
    "/codex diff rcmd_xxx",
    "/codex cancel rcmd_xxx",
    "/codex approve rcmd_xxx test",
    "/codex approve rcmd_xxx commit",
    "/codex approve rcmd_xxx push",
  ].join("\n");
}

export function formatWhoami(event) {
  return [
    "Codex Lark Remote whoami",
    `senderIdType: ${event.senderIdType || "unknown"}`,
    `senderId: ${event.senderId || "unknown"}`,
    event.openId && event.openId !== event.senderId ? `openId: ${event.openId}` : "",
    event.unionId ? `unionId: ${event.unionId}` : "",
    `userHash: ${event.userIdHash || "-"}`,
    "",
    "Add senderId to lark.allowedUsers.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatBridgeStatus({ config, counts, workerBusy, url, larkWs }) {
  const repos = Object.keys(config.repos || {});
  const transport = config.lark?.transport || "websocket";
  return [
    "Codex Lark Remote status",
    `Bridge: ${url || "running"}`,
    `Lark: ${formatLarkTransport({ transport, larkWs })}`,
    `Repos: ${repos.length ? repos.join(", ") : "none configured"}`,
    `Queue: ${formatCounts(counts)}`,
    `Worker: ${workerBusy ? "busy" : "idle"}`,
  ].join("\n");
}

export function formatTask(command) {
  if (!command) return "Task not found.";
  return [
    `Task: ${command.id}`,
    `Status: ${command.status}`,
    `Repo: ${command.repoKey || "-"}`,
    command.branchName ? `Branch: ${command.branchName}` : "",
    command.worktreePath ? `Worktree: ${command.worktreePath}` : "",
    command.diffSummary ? `Diff:\n${command.diffSummary}` : "",
    command.testSummary ? `Validation:\n${command.testSummary}` : "",
    command.error ? `Error:\n${command.error}` : "",
    command.lastNotifyError ? `Last notify error:\n${command.lastNotifyError}` : "",
    command.result ? `Result:\n${truncateForLark(command.result, 1200)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatQueued(command) {
  return [
    `Task created: ${command.id}`,
    `Repo: ${command.repoKey}`,
    "Status: queued",
    "",
    `Request: ${truncateForLark(command.normalizedTask || command.prompt, 500)}`,
  ].join("\n");
}

export function formatFinal(command) {
  if (command.status === "failed") {
    return [
      `Task failed: ${command.id}`,
      command.error || "Unknown error.",
      "",
      `Use /codex status ${command.id} for details.`,
    ].join("\n");
  }
  return [
    `Task ${command.status}: ${command.id}`,
    "",
    "Summary:",
    truncateForLark(command.result || "Codex finished.", 1200),
    "",
    command.diffSummary ? `Files changed:\n${command.diffSummary}` : "Files changed: none",
    command.testSummary ? `Validation:\n${command.testSummary}` : "Validation: not run",
    "",
    "Next actions:",
    `/codex diff ${command.id}`,
    `/codex approve ${command.id} test`,
    `/codex approve ${command.id} commit`,
    `/codex cancel ${command.id}`,
  ].join("\n");
}

function formatCounts(counts = {}) {
  const keys = ["pending", "running", "waiting_review", "completed", "failed", "timeout", "cancelled"];
  return keys.map((key) => `${key}=${counts[key] || 0}`).join(" ");
}

function formatLarkTransport({ transport, larkWs }) {
  if (transport === "webhook") return "webhook";
  if (!larkWs?.enabled) return "websocket disabled";
  if (larkWs.connected) return "websocket connected";
  if (larkWs.starting) return "websocket connecting";
  return `websocket ${larkWs.message || "not connected"}`;
}
