# Codex Lark Remote

Continue the current Codex conversation from Feishu/Lark.

Chinese version: [README.zh-CN.md](README.zh-CN.md)

This repository is the `gxfn` Codex plugin marketplace. The installable plugin
bundle lives in [`plugins/codex-lark-remote/`](plugins/codex-lark-remote/).
The repository root keeps a full README so first-time users can understand the
product before opening the bundled plugin docs.

Bundled plugin docs:

- [English plugin README](plugins/codex-lark-remote/README.md)
- [Chinese plugin README](plugins/codex-lark-remote/README.zh-CN.md)

## Overview

Codex Lark Remote lets you start a handoff from an active Codex chat, leave your
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

First-time users do not need to clone this repository. In Codex, open plugin
marketplace settings, choose **Add plugin marketplace**, and fill the dialog:

```text
Source:
https://github.com/GxFn/codex-lark-remote.git

Git ref:
main

Sparse path:
leave empty
```

After adding the marketplace, enable `codex-lark-remote` from the plugin list.
For a tagged release, set **Git ref** to a release tag, for example `v0.1.16`.

## Configure Feishu/Lark

Create a Feishu/Lark bot app first:

1. Open [Feishu Open Platform](https://open.feishu.cn/) or
   [Lark Open Platform](https://open.larksuite.com/).
2. Create an internal/custom app.
3. Enable the bot capability.
4. In **Credentials & Basic Info**, copy **App ID** and **App Secret**.
5. In **Event Subscriptions**, choose long connection/WebSocket and subscribe to
   `im.message.receive_v1`.
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

When startup succeeds, send any normal message to the Feishu/Lark bot. Codex
will continue the same conversation and reply in Feishu/Lark.

On macOS, the bridge starts `caffeinate -dimsu` while handoff is active so the
Mac can turn the display off without going to sleep. It stops that keep-awake
process when handoff is turned off or the bridge stops.

Useful Feishu/Lark commands:

```text
/codex whoami
/codex status
/codex commands on
/codex commands off
/codex handoff off
```

The bot also recognizes natural requests such as asking to stop or disconnect
the handoff.

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
