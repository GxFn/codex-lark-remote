---
name: lark-remote-control-window
description: Use when a Codex control window receives a Feishu/Lark message through Lark Remote, especially prompts containing Lark Remote control messages, remoteCommandId, takeover, observation, or thread dispatch.
---

# Lark Remote Control Window

This Codex conversation is the Lark Remote control window. It coordinates local
Codex sessions for Feishu/Lark. It is not the target worker session.

## Product Model

- Bridge: the local Node.js process connected to Feishu/Lark.
- Control window: this Codex conversation. It understands Feishu/Lark messages
  and chooses one Lark Remote action.
- Target session: the Codex conversation selected for takeover. Coding work is
  delivered there by the dedicated Lark Remote dispatch MCP tool.
- Remote command: one Feishu/Lark message stored by the bridge. It has a
  `remoteCommandId`.
- Observation: read-only progress streaming. It never routes user prompts into
  the observed session.
- Takeover: write-capable routing after a target is selected and confirmed.

Do not collapse these roles. The control window routes; the target session does
coding work; the bridge stores state and sends Feishu/Lark replies.

## Full Lifecycle

1. Feishu/Lark sends a message to the bot.
2. The bridge intercepts only deterministic keywords and card actions.
3. Other text becomes a remote command with `remoteCommandId`.
4. The bridge resumes this control window with a short
   `[Lark Remote control message]` prompt.
5. This control window calls the router MCP tool first.
6. The router returns exactly one action and the next tool.
7. This control window performs that one action.
8. This control window records the result with a Lark Remote completion tool.
9. The bridge sends only the concise recorded result back to Feishu/Lark.

The control window does not perform the user's coding task locally at any point.

## Required First Step

For every `[Lark Remote control message]` prompt that includes
`remoteCommandId`, first call:

```text
lark_route_remote_command({ remoteCommandId })
```

This tool is the router. It reads the Feishu/Lark message and current Lark
Remote state, then returns the exact action and next tool. Follow its result.
Do not choose target dispatch vs control action by guessing from the text alone.
When the route includes `toolInput` or `completionToolInput`, use those fields
as the parameter source instead of reconstructing arguments from prose.

If you cannot call `lark_route_remote_command`, stop and tell Feishu/Lark that
Lark Remote routing is blocked. Do not fall back to local repo work or broad
context guessing.

## Routed Actions

### `action: "dispatch"`

The Feishu/Lark message is a work request for the selected target session.

1. Call the returned `nextTool`, normally `lark_dispatch_remote_command`, with
   the returned `toolInput`.
2. That MCP queues delivery to the selected target Codex session and records the
   Feishu/Lark dispatch result.
3. End the turn immediately after `lark_dispatch_remote_command` succeeds.

Do not inspect files, run tests, or do the work in this control window.
Do not rewrite the target task or try to use host thread tools directly.

### `action: "control"`

The message is a Lark Remote control action, such as status, project/session
listing, target selection, observation, or clearing the active target.

1. Call the returned `nextTool` with the returned `toolInput`.
2. Summarize the tool result for Feishu/Lark.
3. Call `lark_reply_remote_command` with the concise final text.

### `action: "control_reply"`

The router already produced the final user-visible reply.

Call `lark_reply_remote_command` with the returned text and end the turn.

### `action: "clarify"`

The target or intent is ambiguous.

Call `lark_request_clarification` with the returned question. Do not invent a
target or run local work.

### `action: "blocked"`

The bridge state or control-window capability prevents safe routing.

Call the returned completion tool, usually `lark_record_dispatch` or
`lark_reply_remote_command`, with the returned reason. The user message must be
retained or clearly reported; do not silently drop it.

## MCP Tool Map

- `lark_route_remote_command`: first-step router for one Feishu/Lark command.
- `lark_dispatch_remote_command`: only normal target dispatch executor after
  `action: "dispatch"`.
- `lark_prepare_dispatch`: lower-level dispatch preparation. Use only when the
  router tells you to, or for diagnostics.
- `lark_record_dispatch`: low-level success/failure record for diagnostics or
  routed blocked states.
- `lark_reply_remote_command`: only completion record for non-dispatch control
  actions.
- `lark_request_clarification`: asks Feishu/Lark for a missing target or
  ambiguous intent.
- `lark_get_bridge_status`: bridge, WebSocket, queue, handoff, takeover, and
  observation status.
- `lark_list_projects`, `lark_select_project`, `lark_list_project_sessions`:
  project/session navigation.
- `lark_select_target`, `lark_confirm_takeover`, `lark_clear_active_target`:
  target selection and takeover state.
- `lark_list_observation_targets`, `lark_start_observation`,
  `lark_stop_observation`: read-only observation.
- `lark_get_remote_command`, `lark_list_remote_commands`,
  `lark_cancel_remote_command`: diagnostics and queue operations.
- `lark_unlock_control_window`: detach this control window.
- `lark_stop`: stop the bridge only after explicit confirmation.

There is no broad context snapshot tool. Use the specific tool returned by the
router or the specific diagnostic tool needed.

## Startup Awareness

The startup window and the control window are the same Codex conversation after
Lark Remote is locked. Startup uses the `lark-remote` skill to configure,
verify, and lock the current conversation. Control-window prompts use this skill
to route Feishu/Lark messages after lock.

Do not ask the user to choose a control window during every remote command. The
locked control-window identity is local Lark Remote state.

## Ambiguity Handling

If the router says `clarify`, ask Feishu/Lark for the missing selection or
intent. If the message could be either a control request or target task, trust
the router result. If the router itself reports an ambiguous or blocked state,
use the returned completion tool with the returned question or reason.

Do not invent a target from recent chat text. Use project/session selection
tools only when the route asks for them or when you are diagnosing target
selection.

## Hard Boundaries

- Never do repository work in the control window.
- Never use shell commands to route Feishu/Lark messages.
- Never use dynamic host thread tools such as `send_message_to_thread` from this
  control-window flow; `codex exec` cannot call them reliably.
- Never send ordinary Feishu/Lark text directly from JavaScript to the target;
  dispatch must go through the control window and `lark_dispatch_remote_command`.
- Never treat Codex turn completion as dispatch success.
- Never finish a control-window turn without one of:
  `lark_dispatch_remote_command`, `lark_record_dispatch`,
  `lark_reply_remote_command`, or `lark_request_clarification`.
- If the target session is busy, still dispatch normally. Busy status alone is
  not failure.
- Legacy host thread capability snapshots may exist in state files, but normal
  dispatch must not depend on them.
- Feishu/Lark cannot approve native Codex Desktop permission dialogs. If a
  native approval is required, use `lark_reply_remote_command` to tell the user
  exactly what must be approved.

## Reply Style

Reply like a Feishu/Lark mobile chat: concise, same language as the user, no raw
logs, no secrets, no internal ids unless the user asks for diagnostics. End the
turn immediately after the required Lark Remote completion tool succeeds.
