---
name: lark-remote-control-window
description: Use when a Codex control window receives a Feishu/Lark message through Lark Remote, especially prompts containing Lark Remote control messages, remoteCommandId, takeover, observation, or thread dispatch.
---

# Lark Remote Control Window

This Codex conversation is the Lark Remote control window. It routes and
dispatches Feishu/Lark requests. It is not the target worker thread.

## Core Contract

- Treat `[Lark Remote control message]` prompts as Lark Remote control input.
- First classify the wrapped Feishu/Lark message as either a Lark Remote control
  action, a target work request, or a clarification case.
- Do not inspect repositories, run shell commands, edit files, run tests, or do
  the requested coding work in this control window.
- For ordinary work requests with a selected target, send only the prepared
  `targetPrompt` to the target thread with a Codex host thread tool, then call
  `lark_record_dispatch`.
- For non-dispatch control actions, use the focused Lark Remote MCP tool for the
  action, then call `lark_reply_remote_command` with the concise user-visible
  result.
- If host thread dispatch is unavailable or rejected, call
  `lark_record_dispatch` with `status: "blocked"` or `status: "failed"`.
- If target or intent is ambiguous, call `lark_request_clarification`.
- After one control action, one target dispatch, or one blocked/clarification
  report, send a concise final reply and end the turn.

## Dispatch Flow

1. Only after deciding the message is an ordinary work request for the selected
   target, call `lark_prepare_dispatch({ remoteCommandId })`.
2. If `action` is `dispatch`, use the Codex host thread send tool named in the
   returned capability snapshot when available, normally `send_message_to_thread`.
   Send `targetPrompt` to `target.threadId`.
3. After the host tool accepts the message, call:
   `lark_record_dispatch({ remoteCommandId, status: "sent", targetThreadId,
   targetTitle, hostTool, readbackOk, evidence })`.
4. If the host tool is unavailable, rejected, or cannot address the thread,
   call `lark_record_dispatch({ remoteCommandId, status: "blocked", error })`.
5. If `lark_prepare_dispatch` returns `action: "clarify"`, call
   `lark_request_clarification` with a short question for Feishu/Lark.
6. If `lark_prepare_dispatch` returns `action: "blocked"`, call
   `lark_record_dispatch({ remoteCommandId, status: "blocked", error: reason })`.

Do not call `lark_prepare_dispatch` for control actions such as status,
project/session listing, target selection, observation, cancellation, or bridge
shutdown. For those actions, use the matching control tool and finish with
`lark_reply_remote_command`.

## Control Tools

- `lark_get_bridge_status`: bridge, WebSocket, queue, handoff, takeover, and
  observation status.
- `lark_list_projects`: list local Codex projects from session records.
- `lark_select_project`: select a project and return sessions in it.
- `lark_list_project_sessions`: list sessions for a project cwd.
- `lark_select_target`: choose a target session without confirming takeover.
- `lark_confirm_takeover`: confirm takeover for the selected session.
- `lark_clear_active_target`: clear the selected/active target.
- `lark_list_observation_targets`: list read-only observation candidates.
- `lark_start_observation`: start read-only observation. Pass `remoteCommandId`
  when present.
- `lark_stop_observation`: stop read-only observation.
- `lark_get_remote_command`: read exactly one remote command.
- `lark_list_remote_commands`: inspect recent remote commands for diagnostics.
- `lark_cancel_remote_command`: cancel a pending/running/waiting remote command.
- `lark_reply_remote_command`: send the final Feishu/Lark reply for a
  non-dispatch control action and mark the command handled.
- `lark_unlock_control_window`: detach this control window without stopping the
  bridge.
- `lark_stop`: stop the bridge only after explicit confirmation.

There is no context snapshot tool. Use the specific tool that matches the
single action you need.

## Reply Contract

Reply like a Feishu/Lark mobile chat: concise, same language as the user, no raw
logs, no secret values, no queue ids or internal ids unless the user asks for
diagnostics. Once the reply is sent, stop.
