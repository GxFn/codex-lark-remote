import { truncateForLark } from "./notifier.mjs";

export function formatHelp() {
  return [
    "Codex Lark Remote",
    "",
    "Examples:",
    "[repo] fix the failing test",
    "> force a coding task",
    "/codex status",
    "/codex status rcmd_xxx",
    "/codex diff rcmd_xxx",
    "/codex cancel rcmd_xxx",
  ].join("\n");
}

export function formatBridgeStatus({ config, counts, workerBusy, url }) {
  const repos = Object.keys(config.repos || {});
  return [
    "Codex Lark Remote status",
    `Bridge: ${url || "running"}`,
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
    `/codex cancel ${command.id}`,
  ].join("\n");
}

function formatCounts(counts = {}) {
  const keys = ["pending", "running", "waiting_review", "completed", "failed", "timeout", "cancelled"];
  return keys.map((key) => `${key}=${counts[key] || 0}`).join(" ");
}

