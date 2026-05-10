---
name: codex-lark-remote
description: Use when the user asks to start, configure, diagnose, or use Codex Lark Remote, or when Codex is executing a programming task received from Lark/Feishu through codex-lark-remote. Covers first-run setup, current-thread handoff, remote-chat reporting, and approval gates.
---

# Codex Lark Remote

Use this skill when the user asks to start this plugin, configure Feishu/Lark,
continue Codex from Feishu/Lark, or when the prompt contains
`<codex_lark_remote_context>`, starts with `[Codex Lark Remote handoff]`, or says
a task came from Feishu/Lark chat.

## First-Run Startup

When the user says "start this plugin" or similar:

1. Prefer MCP tools over shell commands. Do not run `bin/codex-lark-bridge.mjs`
   directly and do not inspect `~/.codex-lark-remote/config.json` with shell
   unless a tool result is insufficient.
2. Call `codex_lark_handoff` for the current Codex conversation. It starts the
   bridge, activates current-thread handoff, and returns setup status.
3. If the result says Feishu/Lark app credentials are missing, ask the user for
   the needed fields or call `codex_lark_configure` when they already supplied
   them in chat. Never echo raw secrets back.
4. After `codex_lark_configure`, call `codex_lark_check_auth`, then
   `codex_lark_handoff` again.
5. Keep the final startup response short: bridge status, handoff status, what is
   missing, and the exact next thing the user should provide or send from
   Feishu/Lark.

Current-thread handoff usually sends the Feishu/Lark text directly as the next
Codex user message. In that mode, continue the existing conversation naturally;
do not add queue/task boilerplate unless the user asks for it or a
`codex_lark_remote_context` block is present.

## Workflow

1. Treat the context block as the task boundary, permission model, and reply contract.
2. Work only inside `worktree_path` when it is provided. In current-thread handoff mode, continue the existing Codex conversation normally.
3. Prefer concise progress and final output suitable for a mobile chat.
4. Do not commit, push, merge, publish, or run destructive cleanup unless the context explicitly says the user approved that action.
5. Do not print raw tokens, complete chat ids, complete user ids, environment variables, or long logs.
6. When changes are made, include files changed and validation results.
7. If user review is needed for a worktree task, finish with a `waiting_review` style report and explicit next chat commands. For current-thread handoff, use the normal Codex final answer shape unless the user asks for queue review commands.

## Final Response Shape

Use this compact shape unless the request asks for something else:

```text
Status: waiting_review

Summary:
- ...

Files changed:
- path/to/file

Validation:
- ...

Risks:
- ...

Next actions:
- /codex whoami
- /codex diff <task_id>
- /codex approve <task_id> commit
- /codex cancel <task_id>
```
