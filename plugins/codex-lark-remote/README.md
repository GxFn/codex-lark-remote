# Codex Lark Remote

Remote Codex programming from Feishu/Lark chat.

This plugin keeps the first version intentionally small:

- a local bridge process receives Feishu/Lark events over WebSocket first,
- a local queue records remote worktree tasks and current-thread chat turns,
- a handoff mode can resume the current Codex conversation with `codex exec resume`,
- Codex CLI runs each task in an isolated git worktree,
- chat handoff replies with the Codex answer, while worktree tasks keep status,
  validation, and review actions.

## Codex Plugin Install

This repository includes a Codex marketplace bundle at
`plugins/codex-lark-remote`. For local development, add this repository as a
Codex marketplace in `~/.codex/config.toml` and enable the plugin:

```toml
[marketplaces.codex-lark-remote]
source_type = "local"
source = "/absolute/path/to/codex-lark-remote"

[plugins."codex-lark-remote@codex-lark-remote"]
enabled = true
```

After Codex reloads plugins, start a new Codex conversation and mention the
plugin, for example:

```text
启动 codex-lark-remote，并帮我配置飞书远程接管。
```

The installed plugin reads runtime data and private credentials from
`~/.codex-lark-remote/config.json` unless a tool call passes `dataDir` or
`configPath`. Keep that file out of git.

For a published git marketplace, keep the same plugin id and point the
marketplace source at the release repository/tag:

```toml
[marketplaces.codex-lark-remote]
source_type = "git"
source = "https://github.com/<owner>/codex-lark-remote.git"
revision = "v0.1.1"
```

## Configure From Codex Chat

Prefer configuring this plugin through a Codex chat instead of editing JSON by
hand. Paste the required Feishu/Lark information into the local Codex
conversation and ask Codex to write `~/.codex-lark-remote/config.json`, verify
auth, then start handoff.

Use a prompt like this:

```text
请配置 codex-lark-remote。

飞书应用：
- appId: cli_xxx
- appSecret: xxx
- verificationToken: xxx
- encryptKey: xxx

允许使用者：
- allowedUsers: ["ou_xxx"]

远程编程仓库：
- defaultRepo: codex-lark-remote
- repos.codex-lark-remote.path: /absolute/path/to/codex-lark-remote
- repos.codex-lark-remote.baseBranch: main
- repos.codex-lark-remote.testCommand: npm test

请写入 ~/.codex-lark-remote/config.json，然后运行 codex_lark_check_auth、
codex_lark_diagnose，最后在当前对话里启动 codex_lark_handoff。
```

Notes:

- `appId` and `appSecret` are required for WebSocket long connection and message
  replies.
- `verificationToken` and `encryptKey` are mainly needed for webhook fallback or
  encrypted event verification, but keeping them configured is useful.
- `allowedUsers` should contain Feishu/Lark sender ids. If you do not know your
  sender id yet, leave `allowedUsers` empty during first setup, send
  `/codex whoami` to the bot from Feishu, then add the returned `senderId`.
- `repos` is only required for isolated worktree tasks. Current-thread handoff
  can work with just the Feishu/Lark app credentials and allowlist.
- Paste secrets only into your trusted local Codex conversation. Do not send
  them through Feishu chat and do not commit `~/.codex-lark-remote/config.json`.

The equivalent JSON shape is:

```json
{
  "lark": {
    "appId": "cli_xxx",
    "appSecret": "xxx",
    "verificationToken": "xxx",
    "encryptKey": "xxx",
    "allowedUsers": ["ou_xxx"],
    "transport": "websocket",
    "websocket": true
  },
  "defaultRepo": "codex-lark-remote",
  "repos": {
    "codex-lark-remote": {
      "path": "/absolute/path/to/codex-lark-remote",
      "remote": "origin",
      "baseBranch": "main",
      "testCommand": "npm test"
    }
  }
}
```

## Start Current-Thread Handoff

In Codex chat, ask the agent to start the plugin for the current conversation:

```text
启动 codex-lark-remote handoff，让我接下来可以从飞书继续这个 Codex 对话。
```

Codex should call:

- `codex_lark_check_auth`
- `codex_lark_diagnose`
- `codex_lark_handoff`

In Feishu Event Subscriptions, choose long connection and add
`im.message.receive_v1`. This default path does not need a public callback URL.

When `codex_lark_handoff` is called from an already-open Codex conversation, it
stores the current local Codex thread in `~/.codex-lark-remote/handoff.json`.
Normal Feishu/Lark messages then run through `codex exec resume <thread_id>` so
the model-visible context continues from that conversation. In handoff mode,
ordinary Feishu/Lark text is sent as the direct Codex user message and the bot
replies with the final Codex answer. This is a backend resume route, not GUI
typing into the Codex Desktop composer.

For local testing without Feishu/Lark, create a task manually:

```text
codex_lark_send prompt="fix the failing test" repoKey="example"
```

The bridge exposes a loopback HTTP API for MCP tools and still keeps
`/bridge/lark/event` as a webhook fallback/testing route. If you set
`lark.transport` to `webhook`, put a trusted tunnel or reverse proxy in front of
that route.

To simulate a Feishu/Lark message locally:

```bash
npm run fixture -- --text "[codex-lark-remote] local fixture task"
npm run fixture -- --sign --encrypt --text "[codex-lark-remote] encrypted fixture task"
```

To simulate URL verification:

```bash
npm run fixture -- --sign --encrypt --challenge
```

For the normal WebSocket path, send a Feishu message after `codex_lark_handoff`
reports the bridge is running. For webhook fallback, set `CODEX_LARK_PUBLIC_URL`
or `publicUrl`, then use the webhook URL reported by `codex_lark_diagnose`.

### Worker Runtime Notes

Worktree tasks run with `codex exec --ignore-user-config` by default. This keeps
the child Codex process focused on the task worktree and prevents it from
loading this same Feishu/Lark plugin as a nested MCP server. Set
`runner.ignoreUserConfig` to `false` only when the worker must load tools from
your personal Codex config.

Current-thread handoff tasks run with
`codex exec resume --ignore-user-config <thread_id>`. By default, the Feishu/Lark
text is passed through directly as the next Codex user message. The route
preserves the Codex session history on disk and replies with the final assistant
message captured by `--output-last-message`. Set `handoff.promptStyle` to
`annotated` only if you prefer each resumed turn to include an explicit
Feishu/Lark source marker.

Each task records notification delivery metadata in the queue. If Feishu/Lark
accepts the HTTP request but returns a non-zero API `code`, the task now records
`lastNotifyError` and `/codex status rcmd_xxx` can be used to inspect the
completed result.

## Chat Commands

```text
[repo-key] fix the failing test
> force this message into a coding task
/codex whoami
/codex status
/codex handoff
/codex handoff off
/codex status rcmd_xxx
/codex diff rcmd_xxx
/codex cancel rcmd_xxx
/codex approve rcmd_xxx test
/codex approve rcmd_xxx commit
/codex approve rcmd_xxx push
```

Commit and push are never automatic. They only run after an explicit approve
command and use the task worktree/branch.
