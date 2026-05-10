# Codex Lark Remote

Continue the current Codex conversation from Feishu/Lark.

Chinese version: [README.zh-CN.md](README.zh-CN.md)

This README ships inside the installable Codex plugin bundle. The repository
homepage also has a full first-time user guide.

## Default flow

Codex Lark Remote is designed around one default flow: start from an active
Codex conversation, approve handoff, then continue that same conversation from
Feishu/Lark.

Feishu/Lark messages are passed to Codex as normal user messages. The bot sends
back the final Codex answer and useful progress while work is running.

## Install from Codex

Open Codex plugin marketplace settings, choose **Add plugin marketplace**, and
fill the dialog:

```text
Source:
https://github.com/GxFn/codex-lark-remote.git

Git ref:
main

Sparse path:
leave empty
```

Enable `codex-lark-remote` from the plugin list. For a pinned install, set
**Git ref** to a release tag such as `v0.1.14`.

## Configure Feishu/Lark

Create a Feishu/Lark app:

1. Open [Feishu Open Platform](https://open.feishu.cn/) or
   [Lark Open Platform](https://open.larksuite.com/).
2. Create an internal/custom app.
3. Enable the bot capability.
4. Copy **App ID** and **App Secret** from **Credentials & Basic Info**.
5. In **Event Subscriptions**, choose long connection/WebSocket and subscribe to
   `im.message.receive_v1`.
6. Enable the message receive/reply permissions requested by the platform, then
   publish or enable the app for your tenant.

Paste the values into a trusted local Codex chat:

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

Private config is stored outside the repository:

```text
~/.codex-lark-remote/config.json
```

If you do not know your sender id, leave `allowedUsers` empty at first, send
`/codex whoami` to the bot, then add the returned `senderId`.

The bridge will not start until `appId` and `appSecret` are configured.

## Start handoff

In the Codex conversation you want to continue from Feishu/Lark, say:

```text
Start codex-lark-remote.
```

Codex must ask for explicit consent before starting handoff. After consent, the
plugin stores local routing state for the current Codex thread in the local
bridge. Existing chat history is not sent to Feishu/Lark.

Then send normal messages to the Feishu/Lark bot. They will continue the same
Codex conversation.

On macOS, handoff also starts `caffeinate -dimsu` so the display may turn off
while the Mac stays awake. The keep-awake process is stopped when handoff or the
bridge stops.

Useful commands:

```text
/codex whoami
/codex status
/codex handoff off
```

Plain language requests such as "disconnect" or "stop handoff" are also handled.

## Feishu/Lark output

Remote replies are optimized for coding on a phone or in chat:

- No `Codex progress` title is added to progress messages.
- Internal task ids are not shown in normal progress replies.
- Long replies are split into multiple Feishu/Lark messages.
- Line breaks are preserved for useful output.
- Source/code inspection output is summarized when it comes from commands such
  as `cat`, `nl`, `sed`, `grep`, or ordinary `rg` searches.
- Test output, errors, warnings, and git summaries are kept.

## Mac keep-awake

Enabled by default:

```json
{
  "handoff": {
    "keepAwake": true,
    "keepAwakeCommand": "caffeinate",
    "keepAwakeArgs": ["-dimsu"]
  }
}
```

Set `handoff.keepAwake` to `false` in `~/.codex-lark-remote/config.json` to turn
this off. This feature is macOS-only.

## Troubleshooting

`codex_lark_*` tools are missing:

The plugin MCP server is not loaded in this Codex conversation. Refresh or
re-enable the plugin, then start a new Codex conversation. Normal startup should
not fall back to local scripts.

`/codex status` says `websocket disabled`:

Check `~/.codex-lark-remote/config.json` and confirm that `appId` and
`appSecret` are present.

The same Feishu/Lark message gets two replies:

Stop any stale bridge process or duplicate plugin installation, then start
handoff again.

Codex edits the plugin cache instead of your project:

Start handoff from a Codex conversation whose working directory is the project
you want Codex to edit.

## Local development

Register this repository as a local marketplace:

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
