import { shortHash } from "./config.mjs";

export function buildRunnerPrompt(command, config) {
  const context = buildRemoteContext(command, config);
  return [
    "Use the codex-lark-remote skill.",
    "",
    "If the skill is unavailable, follow these rules: work only in the provided worktree, keep the final report concise for a mobile chat, do not expose secrets or long logs, and do not commit, push, merge, or publish unless approval is explicitly present.",
    "",
    context,
    "",
    "User request from Lark:",
    command.normalizedTask || command.prompt,
  ].join("\n");
}

export function buildRemoteContext(command, config) {
  const policy = config.policy || {};
  return [
    "<codex_lark_remote_context>",
    `task_id: ${command.id}`,
    "source: lark",
    `repo_key: ${command.repoKey}`,
    `project_root: ${command.projectRoot}`,
    `worktree_path: ${command.worktreePath}`,
    `branch_name: ${command.branchName}`,
    "sender:",
    `  user_id_hash: ${command.userIdHash || ""}`,
    `  display_name: ${command.userName || "lark_user"}`,
    "message:",
    `  message_id_hash: ${command.messageId ? `m_${shortHash(command.messageId)}` : ""}`,
    `  chat_id_hash: ${command.chatIdHash || ""}`,
    `  original_text: ${escapeLine(command.prompt)}`,
    `  normalized_task: ${escapeLine(command.normalizedTask || command.prompt)}`,
    "policy:",
    `  sandbox: ${config.runner?.sandbox || "workspace-write"}`,
    `  allowed_repo_keys: [${Object.keys(config.repos || {}).join(", ")}]`,
    `  require_review_for_commit: ${Boolean(policy.requireReviewForCommit)}`,
    `  require_review_for_push: ${Boolean(policy.requireReviewForPush)}`,
    `  allow_network: ${Boolean(policy.allowNetwork)}`,
    `  max_final_chars: ${Number(policy.maxResultChars || 3000)}`,
    "reply_contract:",
    "  audience: lark_mobile_chat",
    "  language: zh-CN",
    "  final_format: concise_remote_task_report",
    "  include: [summary, files_changed, validation, risks, next_actions]",
    "  exclude: [raw_secrets, long_logs, full_diff]",
    "</codex_lark_remote_context>",
  ].join("\n");
}

function escapeLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

