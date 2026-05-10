# Codex Lark Remote

Remote Codex programming from Feishu/Lark chat.

This plugin keeps the first version intentionally small:

- a local bridge process receives Feishu/Lark events over WebSocket first,
- a local queue records remote tasks,
- Codex CLI runs each task in an isolated git worktree,
- concise status, validation, and review actions are sent back to chat.

## Quick Start

### Local Codex Install

This repository includes a Codex marketplace bundle at
`plugins/codex-lark-remote`. To install it locally, add the repo marketplace to
`~/.codex/config.toml` and enable
`codex-lark-remote@codex-lark-remote`:

```toml
[marketplaces.codex-lark-remote]
source_type = "local"
source = "/absolute/path/to/codex-lark-remote"

[plugins."codex-lark-remote@codex-lark-remote"]
enabled = true
```

After Codex reloads plugins, the MCP tools are available in new conversations.
The installed plugin reads runtime data and private credentials from
`~/.codex-lark-remote/config.json` unless a tool call passes `dataDir` or
`configPath`.

1. Copy the example config:

```bash
mkdir -p ~/.codex-lark-remote
cp config/example.config.json ~/.codex-lark-remote/config.json
```

2. Set Feishu/Lark credentials:

```bash
export CODEX_LARK_APP_ID=cli_xxx
export CODEX_LARK_APP_SECRET=xxx
export CODEX_LARK_VERIFICATION_TOKEN=xxx
export CODEX_LARK_ENCRYPT_KEY=xxx
export CODEX_LARK_ALLOWED_USERS=user_id_1,user_id_2
```

You can also put `lark.appId`, `lark.appSecret`, `lark.verificationToken`, and
`lark.encryptKey` in `~/.codex-lark-remote/config.json` or another config path
passed to the MCP tools. `lark.allowedUsers` may be an array of Feishu/Lark user
IDs. Keep that config out of git.

3. Start the bridge through Codex MCP:

```text
codex_lark_check_auth
codex_lark_handoff
codex_lark_diagnose
```

In Feishu Event Subscriptions, choose long connection and add
`im.message.receive_v1`. This default path does not need a public callback URL.

4. For local testing without Feishu/Lark, create a task manually:

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

Remote tasks run with `codex exec --ignore-user-config` by default. This keeps
the child Codex process focused on the task worktree and prevents it from
loading this same Feishu/Lark plugin as a nested MCP server. Set
`runner.ignoreUserConfig` to `false` only when the worker must load tools from
your personal Codex config.

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
/codex status rcmd_xxx
/codex diff rcmd_xxx
/codex cancel rcmd_xxx
/codex approve rcmd_xxx test
/codex approve rcmd_xxx commit
/codex approve rcmd_xxx push
```

Commit and push are never automatic. They only run after an explicit approve
command and use the task worktree/branch.
