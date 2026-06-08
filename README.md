<div align="center">

# Lark Remote

Control, observe, and take over local Codex sessions from Feishu/Lark.

[![Codex Marketplace](https://img.shields.io/badge/Codex%20Marketplace-codex--lark--remote-blue?style=flat-square)](https://www.codex-marketplace.com/plugins/codex-lark-remote)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square)](https://nodejs.org)

[中文](README.zh-CN.md)

</div>

---

- [Why](#why) - [Install](#install) - [Getting Started](#getting-started) - [Configure Feishu/Lark](#configure-feishulark) - [Start With The Console](#start-with-the-console) - [Start From Codex](#start-from-codex) - [How It Works](#how-it-works) - [Behavior And Boundaries](#behavior-and-boundaries) - [Repository Layout](#repository-layout) - [Development](#development)

## Why

Codex is strongest when it can work inside your local project, but you are not
always sitting at the Mac where Codex Desktop is running. Lark Remote bridges
that gap: Codex keeps running locally, while Feishu/Lark becomes the lightweight
remote control surface.

The default product shape is narrow on purpose:

```text
Codex Desktop session
   |
   v
Local Lark Remote bridge
   |
   v
Feishu/Lark bot and control console
   |
   v
Observe, choose, or take over local Codex sessions
```

The bridge is local-first. Existing Codex chat history is not sent to
Feishu/Lark during startup. Feishu/Lark users must be allowed before
project/session takeover is available, and native Codex permission dialogs stay
on the Mac.

This repository is a self-contained Codex plugin marketplace source. The
repository root is the installable Codex plugin root, matching the same layout
style as Wakeflow.

## Install

First-time users do not need to clone this repository.

### Codex Marketplace CLI

Install the approved marketplace artifact:

```bash
npx codex-marketplace add GxFn/codex-lark-remote --plugin
```

To pin the reviewed release:

```bash
npx codex-marketplace add https://github.com/GxFn/codex-lark-remote/tree/v0.2.7 --plugin
```

Then restart or refresh Codex if the plugin list does not update immediately.

### Codex Desktop GitHub Install

If Codex asks for a GitHub target or direct artifact path, use the repository
root:

```text
https://github.com/GxFn/codex-lark-remote/tree/v0.2.7
```

If the Codex dialog separates source, ref, and sparse path, fill it like this:

```text
Source:
https://github.com/GxFn/codex-lark-remote.git

Git ref:
v0.2.7

Sparse path:
(leave empty)
```

Enable `codex-lark-remote` from the plugin list after installation.

### Marketplace Source

This repository includes `.agents/plugins/marketplace.json`. It declares the
`codex-lark-remote` marketplace with a single plugin entry that points at the
repository root. Use `main` only when you intentionally want unreleased changes.

## Getting Started

The short successful path is:

1. Install and enable the plugin in Codex.
2. Create a Feishu/Lark internal app and copy its App ID/App Secret.
3. Tell Codex `copied` or `已复制`; Codex reads the clipboard and calls
   `codex_lark_configure`.
4. Let Codex run `codex_lark_check_auth` and `codex_lark_verify_setup`.
5. Verify long-connection Event Configuration and Callback Configuration in the
   Feishu/Lark Open Platform while the bridge is running.
6. Return to Codex and explicitly approve connecting the current Codex
   conversation to Lark Remote.
7. Send `whoami` to the bot from Feishu/Lark, then add the returned `senderId`
   to `lark.allowedUsers`.
8. In Feishu/Lark, send `console`, choose a project/session, and use
   `takeover 1` or the card buttons.

Daily use after setup is simpler: start Lark Remote from a trusted Codex
conversation, open the Feishu/Lark console, choose a session, then send ordinary
coding requests after takeover is active.

## Configure Feishu/Lark

Create the bot app on the platform you want to connect:

1. Open [Feishu Open Platform](https://open.feishu.cn/) or
   [Lark Open Platform](https://open.larksuite.com/).
2. Use `lark.domain: "feishu"` for Feishu China, which is the default.
   Use `lark.domain: "lark"` for international Lark. App ID/App Secret must
   come from the same Open Platform domain; Feishu and Lark credentials are not
   interchangeable.
3. Create an internal/custom app.
4. Enable the bot capability.
5. In **Credentials & Basic Info**, copy **App ID** and **App Secret**.
6. In **Event Configuration**, choose long connection/WebSocket and subscribe to
   `im.message.receive_v1`.
7. In **Callback Configuration**, choose long connection/WebSocket and subscribe
   to `card.action.trigger`. Keep the Lark Remote bridge running when you click
   verify/save.
8. Add the message receive, send/reply, and card interaction permissions
   requested by the platform, then publish or enable the app for your tenant.

Copy the credentials to the clipboard in this shape:

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

For international Lark, change `domain` to `lark` and use credentials created
at `https://open.larksuite.com`.

Private runtime config is stored outside the repository:

```text
~/.codex-lark-remote/config.json
```

Do not commit that file. For first private setup, `allowedUsers: []` is only a
temporary discovery state. After `whoami` works, add the returned sender id
before using full project/session takeover.

`startup.receiveId` is optional. If configured, the bridge proactively sends a
startup intro card to that chat. Without it, the first allowed Feishu/Lark
message supplies the `chat_id`, receives the intro once, and becomes the
remembered startup target.

## Start With The Console

The Feishu/Lark side has one main entry point: the natural-language console.
After the bridge is connected, send `console` or click the console button on the
startup card.

Console display language is bound per Feishu/Lark chat. Enter with English to
keep later console cards in English; enter with Chinese to keep them in Chinese.
Sending a control phrase in the other language switches that chat's later
display language.

Useful console phrases:

```text
console
project list
session list
enter project 1
observe session 2
takeover 1
status
whoami
commands on
commands off
handoff off
close Lark connection
```

The same controls also work in Chinese: `控制台`, `项目列表`, `会话列表`,
`进入项目 1`, `观察会话 2`, `接管 1`, `状态`, and `关闭飞书连接`.

After takeover, the chat switches to thread-dispatch mode. Ordinary
Feishu/Lark messages go to the dedicated control Codex window as dispatch
requests for the selected Codex session. JavaScript does not send those messages
directly to the target thread; the control Codex window performs real thread
dispatch with Codex host thread tools. They no longer go through
project/session intent routing until you return to the console or exit handoff.

Semantic routing is bilingual and prefix-aware. `control:` / `控制:` forces the
rest of the message to be parsed as a Lark Remote control command, while
`dispatch:` / `派发:` forces it to be delivered as a selected-target dispatch
prompt. In thread-dispatch mode, ordinary text is treated as dispatch unless it
is an exact control command such as `console`, `status`, `observe off`, or
`close Lark connection`. In console mode, project/session phrases remain
controls, but task-like text such as "fix the project list component" or
"帮我实现项目列表分页" is dispatched when a target is active.

## Start From Codex

From a trusted Codex conversation, ask:

```text
Start codex-lark-remote.
```

Codex asks for explicit consent before storing local routing state for this
thread in the local bridge. Existing chat history is not sent to Feishu/Lark.
After you confirm, the plugin starts or reuses the bridge and opens the
Feishu/Lark control path.

When a Codex thread is attached, handoff uses the exact thread id or session
path supplied by Codex. It does not guess the nearest conversation by workspace
path. Feishu/Lark can later choose another allowed local session from the
console.

On macOS, the bridge starts `caffeinate -dimsu` while handoff is active so the
Mac can keep working with the display off. Set `handoff.keepAwake` to `false`
in `~/.codex-lark-remote/config.json` if you prefer to manage sleep manually.

## How It Works

### Local Bridge

The plugin MCP server runs inside Codex and starts a separate local bridge
process. The bridge owns Feishu/Lark WebSocket delivery, event parsing, queue
state, startup notices, observation streams, and handoff routing.

### Target Selection

Feishu/Lark controls target selection with `console`, `windows`, `project list`,
and `takeover`. The bot first lists local Codex projects from session records,
then lists sessions/windows inside the chosen project. These are Codex session
records, not macOS window handles.

### Observation And Takeover

Observation is read-only. Use `observe`, `observe <number>`, and `observe off`
to stream progress from another Codex session without routing Feishu/Lark input
into that session. Observation replies include each newly appended user prompt
as a short `User prompt:` separator before later Codex progress, so separate
turns do not collapse into one continuous assistant stream.

Takeover is write-capable after confirmation. Full-project takeover requires a
non-empty `lark.allowedUsers` allowlist. Ordinary Feishu/Lark messages are sent
to the dedicated control Codex window as thread-dispatch requests for the
selected target. If the target session is active, the control window should
treat the dispatch as a higher-priority interrupt/delivery request instead of
waiting for the target to become idle. During takeover, prompts that Lark
Remote itself sent from Feishu/Lark are not echoed back; prompts appended by
other sources, such as automation or local Codex input, are echoed as `User
prompt:` separators.

## Behavior And Boundaries

Remote replies are optimized for coding in chat:

- Final Codex answers are sent back as normal text.
- Long answers are split across multiple Feishu/Lark messages.
- Progress replies hide internal task ids by default.
- Normal shell commands and `Output:` are hidden by default.
- `commands on` shows command summaries; `commands off` hides them again.
- Risky commands are always shown with a `Warning:` line.
- Source inspection output from `cat`, `nl`, `sed`, `grep`, and normal `rg`
  searches is summarized instead of pasted in full.
- Secrets in command text are redacted before they are sent to Feishu/Lark.

Lark Remote takes over the conversation stream, not the native Codex Desktop UI.
Feishu/Lark cannot click permission dialogs, MCP approvals, sandbox-escalation
prompts, network/install approvals, or other native Codex UI popups. When Codex
hits one of those boundaries, it should send a clear Feishu/Lark message
explaining what approval is needed and where to approve it.

If the selected Codex Desktop session is already working, Lark Remote does not
hot-inject text into the running process. The Feishu/Lark message is not queued;
send it again after the takeover-active notice or after the current Codex turn
finishes.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `./` | Installable Codex plugin bundle. |
| `bin/` | MCP server and local bridge entrypoints. |
| `src/` | Bridge, Feishu/Lark, handoff, observer, presenter, and runner modules. |
| `skills/` | Codex skill instructions bundled with the plugin. |
| `config/example.config.json` | Example private runtime config shape. |
| `test/` | Node test suite. |

## Development

For local development, register this repository as a local marketplace:

```toml
[marketplaces.gxfn]
source_type = "local"
source = "/absolute/path/to/codex-lark-remote"

[plugins."codex-lark-remote@gxfn"]
enabled = true
```

Run tests before publishing:

```text
npm run prepare:codex-plugin-runtime
npm test
```

The Codex plugin root starts MCP through a small wrapper and `runtime.tgz`.
That runtime package bundles npm dependencies such as
`@larksuiteoapi/node-sdk`, so installed plugin caches do not need a checked-in
`node_modules/` directory. Rebuild `runtime.tgz` after dependency or runtime
entrypoint changes.


## Troubleshooting

| Symptom | Check |
| --- | --- |
| `codex_lark_*` tools are missing | Refresh or re-enable the plugin, then start a new Codex conversation. |
| `status` says `websocket disabled` | Confirm `appId`, `appSecret`, and `lark.domain` in `~/.codex-lark-remote/config.json`. |
| Feishu/Lark replies twice | Stop stale bridge processes or duplicate plugin installations. |
| Codex edits the plugin cache | Start handoff from a Codex conversation whose cwd is the project you want to edit. |
| Auth fails for international users | Use `lark.domain: "lark"` and credentials from `https://open.larksuite.com`. |
