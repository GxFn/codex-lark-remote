# Lark Remote

Continue the current Codex conversation from Feishu/Lark.

Chinese version: [README.zh-CN.md](README.zh-CN.md)

Marketplace page: [codex-lark-remote](https://www.codex-marketplace.com/plugins/codex-lark-remote)

This repository is the `gxfn` Codex plugin marketplace. The installable plugin
bundle lives in [`plugins/codex-lark-remote/`](plugins/codex-lark-remote/).
The repository root keeps a full README so first-time users can understand the
product before opening the bundled plugin docs.

Bundled plugin docs:

- [English plugin README](plugins/codex-lark-remote/README.md)
- [Chinese plugin README](plugins/codex-lark-remote/README.zh-CN.md)
- [Technical architecture guide (Chinese)](docs/technical_architecture.zh-cn.md)
- [Cross-thread takeover design (Chinese)](docs/cross_thread_takeover_design.zh-cn.md)

## Overview

Lark Remote lets you start a handoff from an active Codex chat, leave your
Mac, and keep talking to the same Codex thread from Feishu/Lark.

The default experience is intentionally narrow:

- Start from the Codex conversation you want to continue.
- Confirm that this conversation may be handed to the local bridge.
- Send normal messages to the Feishu/Lark bot.
- Receive Codex answers and useful progress in Feishu/Lark.

Feishu/Lark messages are treated as ordinary user messages in the same Codex
conversation. The plugin is WebSocket-first and does not ask users to choose
between multiple modes during normal use.

## Install

First-time users do not need to clone this repository.

### Option A: Codex Marketplace CLI

Install the approved marketplace artifact:

```bash
npx codex-marketplace add GxFn/codex-lark-remote/plugins/codex-lark-remote --plugin
```

To pin the exact reviewed release:

```bash
npx codex-marketplace add https://github.com/GxFn/codex-lark-remote/tree/v0.1.25/plugins/codex-lark-remote --plugin
```

Then restart or refresh Codex if the plugin list does not update immediately.

### Option B: Codex Desktop GitHub install

If Codex asks for a GitHub target or direct artifact path, use the plugin bundle
path, not the repository root:

```text
https://github.com/GxFn/codex-lark-remote/tree/v0.1.25/plugins/codex-lark-remote
```

If the Codex dialog separates source, ref, and sparse path, fill it like this:

```text
Source:
https://github.com/GxFn/codex-lark-remote.git

Git ref:
v0.1.25

Sparse path:
plugins/codex-lark-remote
```

Enable `codex-lark-remote` from the plugin list after installation.

### Option C: Add this repository as a marketplace

This repository also includes `.agents/plugins/marketplace.json`. If you want to
add the whole `gxfn` marketplace instead of the single plugin, use:

```text
Source:
https://github.com/GxFn/codex-lark-remote.git

Git ref:
v0.1.25

Sparse path:
leave empty
```

Use `main` instead of a tag only if you intentionally want the latest unreleased
changes.

## Sync To GxFn Marketplace

After publishing or refreshing the plugin, sync its installable plugin root into the aggregate `GxFn/GxFnCodexMarketplace` repository:

```bash
npm run sync:gxfn-marketplace
```

Use `npm run sync:gxfn-marketplace:push` to copy, commit, and push the marketplace snapshot. Set `GXFN_CODEX_MARKETPLACE_DIR=/path/to/GxFnCodexMarketplace` if the marketplace repository is not checked out next to this repository.

## Configure Feishu/Lark

Create a Feishu/Lark bot app first:

1. Open [Feishu Open Platform](https://open.feishu.cn/) or
   [Lark Open Platform](https://open.larksuite.com/).
2. Create an internal/custom app.
3. Enable the bot capability.
4. In **Credentials & Basic Info**, copy **App ID** and **App Secret**.
5. In **Event Subscriptions**, choose long connection/WebSocket and subscribe to
   `im.message.receive_v1` and `card.action.trigger`.
6. Add the message receive/reply permissions requested by the platform, then
   publish or enable the app for your tenant.

Then paste the values into a trusted local Codex chat:

```text
Please configure codex-lark-remote.

Feishu/Lark app:
- appId: cli_xxx
- appSecret: xxx

Allowed users:
- allowedUsers: ["ou_xxx"]

Please call codex_lark_configure with these values, then run
codex_lark_check_auth.
```

The plugin stores private runtime config in:

```text
~/.codex-lark-remote/config.json
```

Do not commit that file.

If you do not know your Feishu/Lark sender id yet, leave `allowedUsers` empty
for first setup, send `/codex whoami` to the bot from Feishu/Lark, then add the
returned `senderId`.

When `appId` or `appSecret` is missing, the plugin does not start the bridge and
does not attach the Codex conversation. It returns setup guidance instead.

## Start handoff

From the Codex conversation you want to continue remotely, ask:

```text
Start codex-lark-remote.
```

Codex will ask for explicit consent before storing local routing state for the
current thread in the local bridge. Existing chat history is not sent to
Feishu/Lark. After you confirm, the plugin starts the bridge, attaches the
current Codex thread, and waits for Feishu/Lark messages.

Handoff is strict about the current Codex window. The plugin uses the exact
thread id or session path supplied by Codex when the tool is called. If Codex
does not provide that per-window metadata, handoff fails instead of guessing by
workspace path. This prevents another Codex window in the same directory from
receiving the Feishu/Lark stream.

When startup succeeds, send any normal message to the Feishu/Lark bot. Codex
will continue the same conversation and reply in Feishu/Lark.

On macOS, the bridge starts `caffeinate -dimsu` while handoff is active so the
Mac can turn the display off without going to sleep. It stops that keep-awake
process when handoff is turned off or the bridge stops.

Useful Feishu/Lark commands:

```text
/codex whoami
/codex status
/codex takeover
/codex windows
/codex takeover status
/codex takeover off
/codex observe
/codex observe <number|thread-prefix>
/codex observe off
/codex commands on
/codex commands off
/codex handoff off
```

The bot also recognizes natural requests such as asking to stop or disconnect
the handoff.

## Take over another Codex window

From a second Codex chat in the same project, prepare takeover scope with
`codex_lark_prepare_takeover`. Feishu/Lark then controls target selection with
`/codex takeover`.

The bot replies with an interactive card of Codex windows. Use **View** to
inspect a window, **Observe** to stream read-only progress, and **Takeover** to
confirm handoff. If cards are unavailable, reply with `1`, `2`, `3`, etc. to
inspect a window, then send `takeover now`. Running windows enter pending
takeover and attach after the current turn finishes.

## Observe another Codex session

Observation is read-only and separate from handoff. Use `/codex observe` to list
observable Codex sessions, then `/codex observe <number>` or
`/codex observe <thread-prefix>` to stream progress from the selected session
into Feishu/Lark. Messages you send in Feishu/Lark are not routed into the
observed session. Use `/codex observe off` to stop that stream.

## Output behavior

The Feishu/Lark replies are optimized for remote coding:

- Final Codex answers are sent back as normal text.
- Long answers are split into multiple Feishu/Lark messages instead of being
  truncated.
- Progress replies do not include internal task ids by default.
- Normal shell commands and `Output:` are hidden by default.
- Use `/codex commands on` or say "show commands" to enable command display.
  Use `/codex commands off` to hide them again.
- Potentially risky commands are always shown with a `Warning:` line, even when
  normal command display is off.
- When command display is on, command `Output:` is still limited to one
  high-signal line with line/character counts when more content was omitted.
- Source inspection output from commands such as `cat`, `nl`, `sed`, `grep`, and
  ordinary `rg` searches is summarized instead of dumping large code blocks.
- Secrets in command text are redacted before they are sent to Feishu/Lark.

This keeps Feishu/Lark focused on what Codex did, what changed, and what needs
attention.

## Permission boundaries

Lark Remote takes over the conversation stream, not the native Codex
Desktop UI. Feishu/Lark cannot click permission dialogs, MCP approvals,
sandbox-escalation prompts, network/install approvals, or other native Codex UI
popups.

When Codex hits one of those boundaries, the bridge and prompt contract ask the
agent to send a clear Feishu/Lark message instead of waiting silently. The
message explains what permission is needed and whether you must approve it in
Codex Desktop on the Mac or can reply in Feishu/Lark with explicit text consent.

## Mid-run guidance

If you send another Feishu/Lark message while Codex is still working, the plugin
does not try to hot-inject text into the already running Codex process. Instead,
it stores the message as supplemental guidance for the same handoff thread,
acknowledges it in Feishu/Lark, and runs it as the next turn as soon as the
current turn finishes.

## Mac keep-awake

The default handoff config keeps the Mac awake during remote takeover:

```json
{
  "handoff": {
    "keepAwake": true,
    "keepAwakeCommand": "caffeinate",
    "keepAwakeArgs": ["-dimsu"]
  }
}
```

Set `handoff.keepAwake` to `false` in `~/.codex-lark-remote/config.json` if you
prefer to manage sleep manually. This feature only runs on macOS.

## Troubleshooting

If Codex says the `codex_lark_*` tools are not available, the plugin MCP server
was not loaded in that conversation. Refresh or re-enable the plugin, then start
a new Codex conversation. Normal startup should use the plugin MCP tools, not
local shell script fallbacks.

If `/codex status` shows `websocket disabled`, verify that `appId` and
`appSecret` exist in `~/.codex-lark-remote/config.json`, then start handoff
again from Codex.

If Feishu/Lark replies twice to the same message, check for an older local
bridge process or duplicate plugin installation and stop the stale one before
starting again.

If Codex writes files into the plugin cache, start the handoff from the Codex
conversation whose working directory is the project you want to edit.

## Local development

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
npm test
```
