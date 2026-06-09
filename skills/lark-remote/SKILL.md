---
name: lark-remote
description: Use when the user asks to start, configure, diagnose, or use Lark Remote, or when Codex is responding to a Feishu/Lark message through Lark Remote.
---

# Lark Remote

Use this skill when starting or operating Lark Remote. Lark Remote connects a
Feishu/Lark bot to local Codex sessions through one dedicated Codex control
window.

## Startup

Use Lark Remote MCP tools only during normal startup.

1. If `lark_*` tools are not available, stop and tell the user the Lark Remote
   MCP server is not loaded. Ask them to refresh/enable the plugin and start a
   new Codex conversation.
2. If Feishu/Lark credentials are missing, collect them, call `lark_configure`,
   then run `lark_check_auth` and `lark_verify_setup`.
3. Before connecting a Codex conversation, get explicit consent for storing local
   routing state and connecting future Feishu/Lark messages to this bridge.
4. After consent, call `lark_prepare_takeover` for project/session takeover, or
   `lark_lock_control_window` for a control-window-only connection.
5. Pass the control-window host thread capability snapshot silently. If the
   current Codex window can use host thread tools, pass:

```json
{
  "capabilities": {
    "hostThreadSend": { "available": true, "tool": "send_message_to_thread" },
    "hostThreadRead": { "available": true, "tool": "read_thread" },
    "hostThreadInterrupt": { "available": false, "tool": "" }
  }
}
```

If a capability is not available, pass it with `available: false`; do not ask the
user about this capability check.

Keep startup replies short: current readiness and the one next action.

## Remote Operation

After the control window is locked, JavaScript handles only deterministic bridge
keywords and card actions, such as `status`, `控制台`, `commands on/off`,
`observe off`, `退出接管`, and confirmed bridge shutdown. Other Feishu/Lark text
is delivered to the control Codex window.

The control window decides whether a message is a Lark Remote control action,
project/session selection, observation, takeover, clarification, direct state
answer, or target-thread dispatch by first calling:

```text
lark_route_remote_command(remoteCommandId)
```

The router returns the exact action and next tool. For target-thread dispatch it
will direct the control window to use:

```text
Codex host thread send tool
lark_record_dispatch(remoteCommandId, ...)
```

For non-dispatch control actions, it uses the matching `lark_*` control tool and
then `lark_reply_remote_command(remoteCommandId, text)` to send the concise
Feishu/Lark reply and close the command.

Do not expect JavaScript to send ordinary Feishu/Lark text directly to the
target thread. Do not use legacy worktree task mode for ordinary Feishu/Lark
messages.

## Permission Boundary

Feishu/Lark cannot approve native Codex Desktop permission UI. If approval,
sandbox escalation, network/install permission, writing outside allowed roots,
or another native permission dialog is required, reply concisely with what
permission is needed and whether the user must approve it in Codex Desktop or
can provide explicit text consent in Feishu/Lark.

## Observation And Takeover

Observation is read-only. During observation, newly appended user prompts should
be visible in Feishu/Lark as prompt separators so turns do not merge visually.

Takeover is dispatch-oriented. After a session is taken over, Feishu/Lark work
messages are routed to the control window, and the control window dispatches
them to the selected target with host thread tools. If the target is busy, still
attempt normal dispatch; only mark blocked if the host thread tool rejects or is
unavailable.
