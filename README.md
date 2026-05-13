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
- [Feishu natural-language intent translator design (Chinese)](docs/intent_translator_design.zh-cn.md)

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

## Start With The Console

The Feishu/Lark side has one main entry point: the natural-language console.
After the bridge is connected, send `console` or click **Console** on the
startup card.

In the console, use short phrases:

```text
console
project list
session list
open project 1
observe session 2
takeover 1
```

When you take over a Codex session, the chat switches to direct task mode.
Ordinary Feishu/Lark messages are then sent straight to that Codex session as
new tasks or follow-up instructions. They no longer go through project/session
intent routing.

To temporarily return to the console, say `console` or `jump out of handoff`.
To end the current takeover but keep the Feishu/Lark bridge connected, say
`handoff off` or `exit handoff`. To stop the local bridge and disconnect
Feishu/Lark, say `close Lark connection`; the bot asks for confirmation first.

## Daily Flow

1. Install the plugin and configure the Feishu/Lark app once.
2. In Codex, start Lark Remote from the conversation you want to continue.
3. In Feishu/Lark, enter the console and choose a project/session.
4. Take over the session, then send normal coding requests.
5. Use `console` when you need to choose another project or session.

## Install

First-time users do not need to clone this repository.

### Option A: Codex Marketplace CLI

Install the approved marketplace artifact:

```bash
npx codex-marketplace add GxFn/codex-lark-remote/plugins/codex-lark-remote --plugin
```

To pin the exact reviewed release:

```bash
npx codex-marketplace add https://github.com/GxFn/codex-lark-remote/tree/v0.2.1/plugins/codex-lark-remote --plugin
```

Then restart or refresh Codex if the plugin list does not update immediately.

### Option B: Codex Desktop GitHub install

If Codex asks for a GitHub target or direct artifact path, use the plugin bundle
path, not the repository root:

```text
https://github.com/GxFn/codex-lark-remote/tree/v0.2.1/plugins/codex-lark-remote
```

If the Codex dialog separates source, ref, and sparse path, fill it like this:

```text
Source:
https://github.com/GxFn/codex-lark-remote.git

Git ref:
v0.2.1

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
v0.2.1

Sparse path:
leave empty
```

Use `main` instead of a tag only if you intentionally want the latest unreleased
changes.

## Configure Feishu/Lark

Create a Feishu/Lark bot app first:

1. Open [Feishu Open Platform](https://open.feishu.cn/) or
   [Lark Open Platform](https://open.larksuite.com/).
2. Create an internal/custom app.
3. Enable the bot capability.
4. In **Credentials & Basic Info**, copy **App ID** and **App Secret**.
5. In **Event Subscriptions**, choose long connection/WebSocket and subscribe to
   `im.message.receive_v1` and `card.action.trigger`.
6. In **Callback Configuration**, keep **receive callbacks through long
   connection** selected. If you switch to webhook mode, configure
   `/bridge/lark/event` as the callback URL and keep verification token /
   encrypt key in sync.
7. Add the message receive, send/reply, and card interaction callback
   permissions requested by the platform, then publish or enable the app for
   your tenant.

Startup intro cards and takeover buttons require `card.action.trigger`. If text
messages work but card buttons do nothing, verify that the app is published,
`card.action.trigger` is subscribed, callback mode is still long connection, and
the app was republished after permission changes.

Then paste the values into a trusted local Codex chat:

```text
Please configure codex-lark-remote.

Feishu/Lark app:
- appId: cli_xxx
- appSecret: xxx

Allowed users:
- allowedUsers: ["ou_xxx"]

Optional takeover tuning:
- takeover: { projectLimit: 20, selectionTtlMs: 600000 }

Optional startup intro:
- startup: { receiveId: "oc_xxx", receiveIdType: "chat_id", once: true }

Please call codex_lark_configure with these values, then run
codex_lark_check_auth.
```

The plugin stores private runtime config in:

```text
~/.codex-lark-remote/config.json
```

Do not commit that file.

If you do not know your Feishu/Lark sender id yet, leave `allowedUsers` empty
for first setup, send `whoami` to the bot from Feishu/Lark, then add the
returned `senderId`.

`startup.receiveId` is an optional proactive target. When configured, the bridge
sends a startup intro card after the first successful Feishu/Lark
connection or handoff activation. When it is not configured, the first allowed
Feishu/Lark message supplies the current `chat_id`, receives the intro once,
and becomes the default target for later bridge starts. If card delivery fails,
the bridge falls back to a text intro. The sent marker and last remembered chat
are stored in `~/.codex-lark-remote/startup-notice.json`; set `startup.once` to
`false` while debugging if you want the intro every time.

When `appId` or `appSecret` is missing, the plugin does not start the bridge and
does not attach the Codex conversation. It returns setup guidance instead.

## Start From Codex

From the Codex conversation you want to continue remotely, ask:

```text
Start codex-lark-remote.
```

Codex asks for explicit consent before storing local routing state for the
current thread in the local bridge. Existing chat history is not sent to
Feishu/Lark. After you confirm, the plugin starts the bridge, attaches the
current Codex thread, and waits for Feishu/Lark messages.

Handoff is strict about the current Codex session/window. The plugin uses the
exact thread id or session path supplied by Codex when the tool is called. If
Codex does not provide that per-window metadata, handoff fails instead of
guessing by workspace path.

On macOS, the bridge starts `caffeinate -dimsu` while handoff is active so the
Mac can turn the display off without going to sleep. It stops that keep-awake
process when handoff is turned off or the bridge stops.

## Take over Codex sessions from Feishu/Lark

Feishu/Lark controls target selection with `takeover` or `windows`.
Full-project takeover requires `lark.allowedUsers`; if the
allowlist is empty, the bot refuses to list projects or execute takeover.

The bot first replies with a project list from local Codex session records.
Choose a project to open every Codex session/window in that project, including
the session that started takeover. This is based on `~/.codex/sessions`; it is
not a macOS window enumeration. Then use **Observe** for read-only progress
streaming or **Takeover** to confirm handoff. If cards are unavailable, reply
with `1`, `2`, `3`, etc. to choose a project, then choose a session, then send
`takeover now`. Active sessions enter pending takeover and attach after the
current turn finishes.

## Observe another Codex session

Observation is read-only and separate from handoff. Use `observe` to list
observable Codex sessions, then `observe <number>` or
`observe <thread-prefix>` to stream progress from the selected session
into Feishu/Lark. Messages you send in Feishu/Lark are not routed into the
observed session. Use `observe off` to stop that stream.

## Output behavior

The Feishu/Lark replies are optimized for remote coding:

- Final Codex answers are sent back as normal text.
- Long answers are split into multiple Feishu/Lark messages instead of being
  truncated.
- Progress replies do not include internal task ids by default.
- Normal shell commands and `Output:` are hidden by default.
- Use `commands on` or say "show commands" to enable command display.
  Use `commands off` to hide them again.
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

If `status` shows `websocket disabled`, verify that `appId` and
`appSecret` exist in `~/.codex-lark-remote/config.json`, then start handoff
again from Codex.

If Feishu/Lark replies twice to the same message, check for an older local
bridge process or duplicate plugin installation and stop the stale one before
starting again.

If Codex writes files into the plugin cache, start the handoff from the Codex
conversation whose working directory is the project you want to edit.

## Sync To GxFn Marketplace

After publishing or refreshing the plugin, sync its installable plugin root into
the aggregate `GxFn/GxFnCodexMarketplace` repository:

```bash
npm run sync:gxfn-marketplace
```

Use `npm run sync:gxfn-marketplace:push` to copy, commit, and push the
marketplace snapshot. Set
`GXFN_CODEX_MARKETPLACE_DIR=/path/to/GxFnCodexMarketplace` if the marketplace
repository is not checked out next to this repository.

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
