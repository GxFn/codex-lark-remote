<div align="center">

# Lark Remote

Control, observe, and take over local Codex sessions from Feishu/Lark.

[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square)](https://nodejs.org)

[中文](README.zh-CN.md)

</div>

---

- [Why](#why) - [Install](#install) - [Getting Started](#getting-started) - [Configure Feishu/Lark](#configure-feishulark) - [Console And Takeover](#console-and-takeover) - [Runtime Behavior](#runtime-behavior) - [Bundle Layout](#bundle-layout) - [Development](#development)

## Why

This README ships inside the installable Codex plugin bundle. Lark Remote lets
you keep Codex running locally while Feishu/Lark becomes the remote control
surface for local Codex projects and sessions.

```text
Codex conversation
   |
   v
Local bridge
   |
   v
Feishu/Lark console
   |
   v
Observe or take over a selected Codex session
```

The startup conversation can be attached as the first target, but Feishu/Lark
can also list projects, choose another session, observe progress, or take over
a selected Codex session after the bridge is connected.

## Install

Install from the approved Codex Marketplace artifact:

```bash
npx codex-marketplace add GxFn/codex-lark-remote/plugins/codex-lark-remote --plugin
```

For the pinned reviewed release:

```bash
npx codex-marketplace add https://github.com/GxFn/codex-lark-remote/tree/v0.2.5/plugins/codex-lark-remote --plugin
```

If Codex asks for a GitHub target or direct artifact path, use:

```text
https://github.com/GxFn/codex-lark-remote/tree/v0.2.5/plugins/codex-lark-remote
```

If the Codex dialog separates source, ref, and sparse path, fill it like this:

```text
Source:
https://github.com/GxFn/codex-lark-remote.git

Git ref:
v0.2.5

Sparse path:
plugins/codex-lark-remote
```

Enable `codex-lark-remote` from the plugin list after installation. To add the
whole `gxfn` repository marketplace instead of only this plugin, use the
repository root with an empty sparse path. Use `main` only when you want
unreleased changes.

## Getting Started

The recommended first run:

1. Create the Feishu/Lark app and copy App ID/App Secret.
2. Return to Codex and say `copied` or `已复制`.
3. Codex reads the clipboard, saves config with `codex_lark_configure`, then
   runs `codex_lark_check_auth`.
4. Codex runs `codex_lark_verify_setup` so the bridge is connected before you
   verify the Feishu/Lark Open Platform pages.
5. Verify long-connection Event Configuration and Callback Configuration.
6. Return to Codex and explicitly approve connecting the current conversation.
7. Send `whoami` from Feishu/Lark and add the returned sender id to
   `lark.allowedUsers`.
8. Send `console` from Feishu/Lark and choose a project/session.

The bridge will not start until `appId` and `appSecret` are configured.

## Configure Feishu/Lark

Create the app on the platform you want to connect:

1. Open [Feishu Open Platform](https://open.feishu.cn/) or
   [Lark Open Platform](https://open.larksuite.com/).
2. Use `lark.domain: "feishu"` for Feishu China, which is the default.
   Use `lark.domain: "lark"` for international Lark. App credentials must come
   from the same Open Platform domain.
3. Create an internal/custom app.
4. Enable the bot capability.
5. Copy **App ID** and **App Secret** from **Credentials & Basic Info**.
6. In **Event Configuration**, choose long connection/WebSocket and subscribe to
   `im.message.receive_v1`.
7. In **Callback Configuration**, choose long connection/WebSocket and subscribe
   to `card.action.trigger`.
8. Enable message receive, send/reply, and card interaction permissions, then
   publish or enable the app for your tenant.

Clipboard shape:

```text
Feishu/Lark app:
- domain: feishu
- appId: cli_xxx
- appSecret: xxx

Allowed users:
- allowedUsers: []

Optional takeover tuning:
- takeover: { projectLimit: 20, selectionTtlMs: 600000 }

Optional startup intro:
- startup: { receiveId: "oc_xxx", receiveIdType: "chat_id", once: true }
```

For international Lark, set `domain` to `lark` and use credentials created at
`https://open.larksuite.com`.

Private config is stored outside the repository:

```text
~/.codex-lark-remote/config.json
```

Use `allowedUsers: []` only for the first private setup. After `whoami` works,
add your sender id before project/session takeover.

## Console And Takeover

After the bridge is connected, send `console` or click the console button on the
startup card.

Useful commands:

```text
console
project list
session list
enter project 1
observe session 2
takeover 1
status
whoami
handoff off
close Lark connection
```

Chinese equivalents include `控制台`, `项目列表`, `会话列表`, `进入项目 1`,
`观察会话 2`, `接管 1`, `状态`, and `关闭飞书连接`.

Observation is read-only and separate from handoff. Use `observe`,
`observe <number>`, or `observe <thread-prefix>` to stream progress from a
selected session into Feishu/Lark. Use `observe off` to stop.

Takeover is write-capable after confirmation. Feishu/Lark first shows local
Codex projects, then sessions/windows inside the chosen project. These are local
Codex session records, not macOS window handles. Active sessions attach after
they become idle. Messages sent while the selected session is busy are not
queued; send them again after the takeover-active notice appears.

## Runtime Behavior

Remote replies are optimized for coding on a phone or in chat:

- No extra progress title is added to progress messages.
- Internal task ids are hidden in normal progress replies.
- Long replies are split into multiple Feishu/Lark messages.
- Normal shell commands and `Output:` are hidden by default.
- `commands on` enables command summaries; `commands off` hides them again.
- Risky commands are always shown with a `Warning:` line.
- Source inspection output from `cat`, `nl`, `sed`, `grep`, or ordinary `rg`
  searches is summarized.
- Secrets in command text are redacted before delivery.

Lark Remote controls the conversation stream, not the native Codex Desktop UI.
Feishu/Lark cannot click permission dialogs, MCP approvals, sandbox-escalation
prompts, network/install approvals, or other native UI popups. The agent should
send a clear Feishu/Lark prompt when one of those approvals is required.

On macOS, handoff starts `caffeinate -dimsu` by default. Set
`handoff.keepAwake` to `false` in the private config to disable it.

## Bundle Layout

| Path | Purpose |
| --- | --- |
| `.codex-plugin/` | Codex plugin manifest. |
| `.mcp.json` | Plugin MCP server declaration. |
| `bin/` | MCP server and local bridge entrypoints. |
| `src/` | Bridge, Feishu/Lark, handoff, observer, presenter, and runner modules. |
| `skills/` | Codex skill instructions. |
| `config/example.config.json` | Example private runtime config shape. |
| `README.md` | English bundled plugin guide. |
| `README.zh-CN.md` | Chinese bundled plugin guide. |

## Development

For local development, register this repository as a local marketplace:

```toml
[marketplaces.gxfn]
source_type = "local"
source = "/absolute/path/to/codex-lark-remote"

[plugins."codex-lark-remote@gxfn"]
enabled = true
```

Run tests:

```text
npm test
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `codex_lark_*` tools are missing | Refresh or re-enable the plugin, then start a new Codex conversation. |
| `status` says `websocket disabled` | Confirm `appId`, `appSecret`, and `lark.domain` in `~/.codex-lark-remote/config.json`. |
| The same Feishu/Lark message gets two replies | Stop stale bridge processes or duplicate plugin installs. |
| Codex edits the plugin cache | Start handoff from the Codex conversation for the target project. |
| International Lark auth fails | Use `lark.domain: "lark"` with credentials from `https://open.larksuite.com`. |
