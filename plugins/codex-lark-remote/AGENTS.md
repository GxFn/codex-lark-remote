# Lark Remote Agent Guide

Lark Remote connects Feishu/Lark to local Codex sessions through one local
bridge and one locked Codex control window. The bridge stores state, talks to
Feishu/Lark, routes remote commands, and performs deterministic dispatch through
local JS/HTTP endpoints. Target sessions do the coding work.

## Global Contract

- Lark Remote is a control-window product, not a worktree task runner.
- The Codex conversation that starts or locks Lark Remote is the control window.
- A selected takeover session is the target session.
- Ordinary Feishu/Lark work requests are dispatched to the selected target by
  the bridge runner's local route/dispatch executor.
- The control window must not inspect repositories, edit files, run tests, or
  answer the coding task locally.
- The bridge must not send ordinary Feishu/Lark text directly to a target
  session. Dispatch goes through a stored remote command and the Lark Remote
  route/dispatch executor.

## Skill Map

- Use the `lark-remote` skill for startup, setup, bridge status, credentials,
  and locking the current Codex conversation as the control window.
- Use the `lark-remote-control-window` skill whenever a prompt contains
  `[Lark Remote control message]`, `remoteCommandId`, takeover routing,
  observation routing, or thread dispatch.

## Control Window Protocol

Normal bridge operation executes this protocol locally from the runner, not by
starting a `codex exec` control-window turn. Use the MCP steps below only when a
control-window prompt is explicitly delivered to Codex or for diagnostics.

For a `[Lark Remote control message]`, the first MCP call must be:

```text
lark_route_remote_command({ remoteCommandId })
```

That router reads the stored Feishu/Lark command, active target, takeover state,
and locked control-window state. It returns `action`, `nextTool`, `toolInput`,
and the required completion tool. Follow that route exactly.

Do not choose tools by guessing from the visible Feishu/Lark text when a route
exists. The router is the source of truth for whether this is a control request,
clarification, blocked state, or target-session dispatch.

Every control-window turn must finish with exactly one of these Lark Remote
completion tools:

- `lark_dispatch_remote_command`
- `lark_record_dispatch`
- `lark_reply_remote_command`
- `lark_request_clarification`

A plain Codex final answer is not a Lark Remote result.

## MCP Tool Families

- First-step router: `lark_route_remote_command`.
- Target dispatch: `lark_dispatch_remote_command` only after the router returns
  `action: "dispatch"`. `lark_prepare_dispatch` and `lark_record_dispatch` are
  lower-level diagnostics/completion helpers.
- Control status and navigation: `lark_get_bridge_status`,
  `lark_list_projects`, `lark_select_project`,
  `lark_list_project_sessions`, `lark_select_target`,
  `lark_confirm_takeover`, `lark_clear_active_target`, then
  `lark_reply_remote_command`.
- Observation: `lark_list_observation_targets`, `lark_start_observation`,
  `lark_stop_observation`, then `lark_reply_remote_command`.
- Queue diagnostics: `lark_get_remote_command`, `lark_list_remote_commands`,
  `lark_cancel_remote_command`.
- Bridge lifecycle: `lark_unlock_control_window`, `lark_stop`.

There is no broad context snapshot tool. Use the specific route or diagnostic
tool for the question at hand.

## Dispatch Rules

When the router returns `action: "dispatch"`:

1. In normal runner flow, call the local `/bridge/dispatch/execute` endpoint
   with the returned `remoteCommandId`.
2. If working inside an explicit control-window MCP turn, call
   `lark_dispatch_remote_command` with the returned `remoteCommandId`.
3. The dispatch executor queues the target-session delivery and records the
   Feishu/Lark dispatch result.
4. Stop immediately after dispatch succeeds.

Busy target status is not a failure by itself. Dispatch still queues normally
for the selected target session.

## Feishu/Lark Output

Feishu/Lark replies must be concise and user-facing. Do not expose internal
queue ids, raw MCP JSON, runner logs, or control-window prompts unless the user
explicitly asks for diagnostics.

## Boundaries

- Do not use retired tool names from older releases.
- Do not use legacy worktree approval/task tools for ordinary Feishu/Lark
  messages.
- Do not report dispatch success until the local dispatch endpoint,
  `lark_dispatch_remote_command`, or the routed completion tool succeeds.
- If a native Codex Desktop permission is required, reply through
  `lark_reply_remote_command` with the exact approval needed.
