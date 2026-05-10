# Codex Lark Remote

Remote Codex programming from Feishu/Lark chat.

This plugin keeps the first version intentionally small:

- a local bridge process receives Feishu/Lark events,
- a local queue records remote tasks,
- Codex CLI runs each task in an isolated git worktree,
- concise status, validation, and review actions are sent back to chat.

## Quick Start

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
passed to the MCP tools. Keep that config out of git.

3. Start the bridge through Codex MCP:

```text
codex_lark_check_auth
codex_lark_start
```

4. For local testing without Feishu/Lark, create a task manually:

```text
codex_lark_send prompt="fix the failing test" repoKey="example"
```

The bridge exposes a loopback HTTP API for MCP tools and a `/bridge/lark/event`
webhook route for Feishu/Lark event delivery. For a real Feishu webhook, put a
trusted tunnel or reverse proxy in front of that route.

To simulate a Feishu/Lark message locally:

```bash
npm run fixture -- --text "[codex-lark-remote] local fixture task"
npm run fixture -- --encrypt --text "[codex-lark-remote] encrypted fixture task"
```

To simulate URL verification:

```bash
npm run fixture -- --challenge
```

## Chat Commands

```text
[repo-key] fix the failing test
> force this message into a coding task
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
