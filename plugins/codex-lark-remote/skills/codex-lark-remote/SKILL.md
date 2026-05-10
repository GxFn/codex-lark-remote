---
name: codex-lark-remote
description: Use when the user asks to start, configure, diagnose, or use Codex Lark Remote, or when Codex is responding to a Feishu/Lark message through codex-lark-remote. Defaults to continuing the current Codex conversation from Feishu/Lark.
---

# Codex Lark Remote

Use this skill when the user asks to start this plugin, configure Feishu/Lark,
or continue Codex from Feishu/Lark.

## Default Startup

Treat the product as one default flow: Feishu/Lark takes over the current Codex
conversation. Do not explain alternate task, repo, webhook, worktree, or approval
flows unless the user explicitly asks for advanced behavior.

When the user says "start this plugin" or similar:

1. Prefer MCP tools over shell commands.
2. Call `codex_lark_diagnose` first.
3. If Feishu/Lark `appId` or `appSecret` is missing, do not call
   `codex_lark_start` or `codex_lark_handoff`. Ask for the missing values and
   give the short platform path: create an internal/custom app in Feishu/Lark
   Open Platform, enable bot capability, copy App ID/App Secret from
   Credentials & Basic Info, choose long connection/WebSocket in Event
   Subscriptions, and subscribe to `im.message.receive_v1`.
4. If the user already supplied the values in chat, call `codex_lark_configure`.
   Never echo raw secrets back.
5. After configuration, call `codex_lark_check_auth`, then
   `codex_lark_handoff` for the current Codex conversation.
6. Keep the final startup response short: whether Feishu takeover is ready, what
   is missing, and the one next action.

## Remote Replies

Feishu/Lark text should be treated as the next normal Codex user message in the
same conversation. Continue naturally and avoid queue/task boilerplate. Mention
internal ids, queues, repo keys, worktrees, approval commands, or alternate
routes only when the user asks for diagnostics or advanced operation.

When a Feishu/Lark turn is completed, answer in the same concise style you would
use in Codex chat. Include changed files and validation only when they matter to
the user's request.
