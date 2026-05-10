# Codex Lark Remote

Continue the current Codex conversation from Feishu/Lark.

Chinese version: [README.zh-CN.md](README.zh-CN.md)

This repository is the `gxfn` Codex plugin marketplace. The installable plugin
bundle lives in [`plugins/codex-lark-remote/`](plugins/codex-lark-remote/).
The repository root intentionally keeps its own full README so first-time users
can understand installation, configuration, and usage before opening the bundled
plugin docs.

Bundled plugin docs:

- [English plugin README](plugins/codex-lark-remote/README.md)
- [Chinese plugin README](plugins/codex-lark-remote/README.zh-CN.md)

## What it does

Codex Lark Remote lets you start a handoff from an active Codex chat, leave your
Mac, and continue the same Codex conversation from Feishu/Lark. Feishu/Lark
messages are passed to Codex as normal user messages, and the bot replies with
the final Codex answer plus useful progress updates while longer work is running.

The default path is deliberately simple: one active Codex conversation, one
Feishu/Lark bot, and WebSocket-first delivery. The plugin does not ask users to
choose between multiple operating modes during normal use.

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
For a tagged release, set **Git ref** to the release tag, for example `v0.1.10`.

## Configure Feishu/Lark

If you do not have Feishu/Lark app credentials yet:

1. Open [Feishu Open Platform](https://open.feishu.cn/) or
   [Lark Open Platform](https://open.larksuite.com/).
2. Create an internal/custom app.
3. Enable the bot capability.
4. In **Credentials & Basic Info**, copy **App ID** and **App Secret**.
5. In **Event Subscriptions**, choose long connection/WebSocket and subscribe to
   `im.message.receive_v1`.
6. Add the message receive/reply permissions requested by the platform, then
   publish or enable the app for your tenant.

Start from a trusted local Codex chat and paste the required values:

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

The plugin stores private runtime config in `~/.codex-lark-remote/config.json`.
Do not commit that file. If you do not know your Feishu/Lark sender id yet,
leave `allowedUsers` empty for first setup, send `/codex whoami` to the bot from
Feishu/Lark, then add the returned `senderId`.

When `appId` or `appSecret` is missing, the plugin does not start the local
bridge and does not attach the Codex conversation. It returns setup guidance
instead.

## Start handoff

From the Codex conversation you want to continue remotely, ask Codex:

```text
Start codex-lark-remote.
```

Codex will ask for explicit consent before handing the current conversation and
necessary routing metadata to the local plugin bridge. After you confirm, the
plugin starts the bridge, attaches the current Codex thread, and waits for
Feishu/Lark messages.

When startup succeeds, send any normal message to the Feishu/Lark bot. It will
continue the same Codex conversation and reply in Feishu/Lark.

Useful Feishu/Lark commands:

```text
/codex whoami
/codex status
/codex handoff off
```

The bot also recognizes natural requests such as asking to disconnect or stop
the handoff.

## Troubleshooting

If Codex says the `codex_lark_*` tools are not available, the plugin MCP server
was not loaded in that conversation. Refresh or re-enable the plugin, then start
a new Codex conversation. Normal startup should use the plugin MCP tools rather
than local shell scripts.

If `/codex status` shows `websocket disabled`, verify that `appId` and
`appSecret` are present in `~/.codex-lark-remote/config.json`, then restart the
handoff from Codex.

If Feishu/Lark replies twice to the same message, check for an older local
bridge process or duplicate plugin installation and stop the stale one before
starting again.

## Local development

For local development, register this repository as a local marketplace:

```toml
[marketplaces.gxfn]
source_type = "local"
source = "/absolute/path/to/codex-lark-remote"

[plugins."codex-lark-remote@gxfn"]
enabled = true
```

Run the test suite before publishing:

```text
npm test
```
