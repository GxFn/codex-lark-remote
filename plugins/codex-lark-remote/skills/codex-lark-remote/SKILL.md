---
name: codex-lark-remote
description: Use when Codex is executing a programming task received from Lark/Feishu through codex-lark-remote, especially when the prompt contains a codex_lark_remote_context block. Follow the remote-chat reporting contract, respect approval gates, keep progress and final output concise, and avoid exposing secrets or long logs.
---

# Codex Lark Remote

Use this skill when the prompt contains `<codex_lark_remote_context>` or says a task came from Feishu/Lark chat.

## Workflow

1. Treat the context block as the task boundary, permission model, and reply contract.
2. Work only inside `worktree_path` when it is provided.
3. Prefer concise progress and final output suitable for a mobile chat.
4. Do not commit, push, merge, publish, or run destructive cleanup unless the context explicitly says the user approved that action.
5. Do not print raw tokens, complete chat ids, complete user ids, environment variables, or long logs.
6. When changes are made, include files changed and validation results.
7. If user review is needed, finish with a `waiting_review` style report and explicit next chat commands.

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
- /codex diff <task_id>
- /codex approve <task_id> commit
- /codex cancel <task_id>
```

