# Codex Lark Remote

Continue the current Codex conversation from Feishu/Lark.

Chinese version: [README.zh-CN.md](README.zh-CN.md)

The default experience is intentionally simple: start this plugin inside an
active Codex chat, leave your Mac, and keep talking to the same Codex thread
from Feishu/Lark. Feishu/Lark messages are passed to Codex as normal user
messages, and the bot replies with the final Codex answer.

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
For a tagged release, set **Git ref** to the release tag, for example `v0.1.2`.

## Configure

Start from a local Codex chat and say:

```text
Start codex-lark-remote and help me configure Feishu/Lark remote takeover.
```

If you do not have Feishu/Lark credentials yet:

1. Open [Feishu Open Platform](https://open.feishu.cn/) or
   [Lark Open Platform](https://open.larksuite.com/).
2. Create an internal/custom app.
3. Enable the bot capability.
4. In **Credentials & Basic Info**, copy **App ID** and **App Secret**.
5. In **Event Subscriptions**, choose long connection/WebSocket and subscribe to
   `im.message.receive_v1`.
6. Add the message receive/reply permissions requested by the platform, then
   publish or enable the app for your tenant.

Paste the credentials into your trusted local Codex chat:

```text
Please configure codex-lark-remote.

Feishu/Lark app:
- appId: cli_xxx
- appSecret: xxx

Allowed users:
- allowedUsers: ["ou_xxx"]

Please call codex_lark_configure with these values, then run
codex_lark_check_auth and codex_lark_handoff for this Codex conversation.
```

The plugin stores private runtime config in `~/.codex-lark-remote/config.json`.
Do not commit that file. If you do not know your Feishu/Lark sender id yet,
leave `allowedUsers` empty for first setup, send `/codex whoami` to the bot from
Feishu/Lark, then add the returned `senderId`.

When `appId` or `appSecret` is missing, the plugin does not start the local
bridge and does not attach the Codex conversation. It returns the setup steps
above instead.

## Use

From the Codex conversation you want to continue remotely, ask Codex:

```text
Start codex-lark-remote.
```

When startup succeeds, send any normal message to the Feishu/Lark bot. It will
continue the same Codex conversation and reply in Feishu/Lark.

Useful Feishu/Lark commands:

```text
/codex whoami
/codex status
/codex handoff off
```

Local development can register this repository as a local marketplace:

```toml
[marketplaces.codex-lark-remote]
source_type = "local"
source = "/absolute/path/to/codex-lark-remote"

[plugins."codex-lark-remote@codex-lark-remote"]
enabled = true
```
