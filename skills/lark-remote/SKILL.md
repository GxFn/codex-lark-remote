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
5. Do not ask the user about the current Codex tool surface. Normal dispatch is executed by
   the bridge runner through local JS/HTTP route and dispatch endpoints.

Keep startup replies short: current readiness and the one next action.

## Remote Operation

After the control window is locked, the bridge handles deterministic keywords
and card actions, such as `status`, `控制台`, `commands on/off`, `observe off`,
`退出接管`, and confirmed bridge shutdown. Other Feishu/Lark text is stored as a
remote command and routed by the bridge runner through local JS/HTTP endpoints.

The normal runtime path is:

```text
/bridge/remote-command/route
/bridge/dispatch/execute | /bridge/remote-command/reply | other specific bridge endpoint
```

This path does not start a new `codex exec` control-window turn and does not ask
that turn to call MCP tools. The MCP tools `lark_route_remote_command`,
`lark_dispatch_remote_command`, `lark_record_dispatch`,
`lark_request_clarification`, and `lark_reply_remote_command` are the equivalent
manual/diagnostic fallback when an explicit control-window prompt is resumed in
Codex.

Do not use legacy worktree task mode for ordinary Feishu/Lark messages.

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
messages are routed and queued by the local bridge runner, then delivered to the
selected target Codex session. If the target is busy, still dispatch normally;
busy status alone is not a failure.
