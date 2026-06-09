# Lark Remote Agent Guide

Lark Remote connects Feishu/Lark to local Codex sessions through one local
bridge and one Codex control window. The bridge stores state and talks to
Feishu/Lark. The control window understands remote messages and chooses the next
Lark Remote action. Target sessions do the coding work.

## Global Contract

- Lark Remote is a control-window product, not a worktree task runner.
- The Codex conversation that starts or locks Lark Remote is the control window.
- A selected takeover session is the target session.
- Ordinary Feishu/Lark work requests are dispatched to the selected target with
  Codex host thread tools.
- The control window must not inspect repositories, edit files, run tests, or
  answer the coding task locally.
- The bridge must not send ordinary Feishu/Lark text directly to a target
  session. Dispatch goes through the control window.

## Skill Map

- Use the `lark-remote` skill for startup, setup, bridge status, credentials,
  and locking the current Codex conversation as the control window.
- Use the `lark-remote-control-window` skill whenever a prompt contains
  `[Lark Remote control message]`, `remoteCommandId`, takeover routing,
  observation routing, or thread dispatch.

## Control Window Protocol

For a `[Lark Remote control message]`, the first MCP call must be:

```text
lark_route_remote_command({ remoteCommandId })
```

That router reads the stored Feishu/Lark command, active target, takeover state,
and locked control-window capabilities. It returns `action`, `nextTool`,
`toolInput`, and the required completion tool. Follow that route exactly.

Do not choose tools by guessing from the visible Feishu/Lark text when a route
exists. The router is the source of truth for whether this is a control request,
clarification, blocked state, or target-session dispatch.

Every control-window turn must finish with exactly one of these Lark Remote
completion tools:

- `lark_record_dispatch`
- `lark_reply_remote_command`
- `lark_request_clarification`

A plain Codex final answer is not a Lark Remote result.

## MCP Tool Families

- First-step router: `lark_route_remote_command`.
- Target dispatch: `lark_prepare_dispatch` only when routed or diagnosing,
  host thread send/read tools, then `lark_record_dispatch`.
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

1. Send the returned `targetPrompt` to the returned target thread with the
   returned host thread tool, normally `send_message_to_thread`.
2. If the host tool accepts delivery, call `lark_record_dispatch` with
   `status: "sent"`.
3. If the host tool is unavailable or rejects delivery, call
   `lark_record_dispatch` with `status: "blocked"` or `status: "failed"`.
4. Stop immediately after the record tool succeeds.

Busy target status is not a failure by itself. Dispatch should still be
attempted if the host thread tool accepts messages.

## Feishu/Lark Output

Feishu/Lark replies must be concise and user-facing. Do not expose internal
queue ids, raw MCP JSON, runner logs, or control-window prompts unless the user
explicitly asks for diagnostics.

## Boundaries

- Do not use retired tool names from older releases.
- Do not use legacy worktree approval/task tools for ordinary Feishu/Lark
  messages.
- Do not report dispatch success until `lark_record_dispatch` succeeds.
- If a native Codex Desktop permission is required, reply through
  `lark_reply_remote_command` with the exact approval needed.
