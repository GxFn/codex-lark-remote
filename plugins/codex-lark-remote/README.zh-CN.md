# Codex Lark Remote

从飞书/Lark 聊天远程继续和驱动 Codex。

English version: [README.md](README.md)

这个插件的第一个版本刻意保持小而清晰：

- 本地 bridge 进程优先通过 WebSocket 长连接接收飞书/Lark 事件；
- 本地队列记录远程 worktree 任务和当前线程聊天轮次；
- handoff 模式可以通过 `codex exec resume` 继续当前 Codex 对话；
- Codex CLI 可以把独立任务运行在隔离的 git worktree 中；
- chat handoff 直接把 Codex 回答返回飞书，而 worktree 任务保留状态、验证和审批动作。

## Codex 插件安装

首次安装用户不需要先 clone 这个仓库。在 Codex 的插件市场设置里打开“添加插件市场”，按下面填写：

```text
来源：
https://github.com/GxFn/codex-lark-remote.git

Git 引用：
main

稀疏路径：
留空
```

插件市场文件位于仓库根目录：`.agents/plugins/marketplace.json`。它会指向真正的插件包：`plugins/codex-lark-remote`。

添加市场后，在插件列表里启用 `codex-lark-remote`。然后新开一个 Codex 对话并提到插件，例如：

```text
启动 codex-lark-remote，并帮我配置飞书远程接管。
```

发布 tag 之后，可以把 “Git 引用” 从 `main` 改成具体版本号，例如 `v0.1.1`。

仅本地插件开发时，才需要把这个仓库作为 local marketplace 加到 `~/.codex/config.toml`：

```toml
[marketplaces.codex-lark-remote]
source_type = "local"
source = "/absolute/path/to/codex-lark-remote"

[plugins."codex-lark-remote@codex-lark-remote"]
enabled = true
```

已安装插件默认从 `~/.codex-lark-remote/config.json` 读取运行数据和私密凭据，除非工具调用显式传入 `dataDir` 或 `configPath`。不要把这个文件提交到 git。

## 通过 Codex 聊天配置

推荐通过 Codex 聊天配置这个插件，而不是手工编辑 JSON。把必要的飞书/Lark 信息粘贴到本地 Codex 对话里，让 Codex 写入 `~/.codex-lark-remote/config.json`、验证鉴权，然后启动 handoff。

可以使用类似这样的提示：

```text
请配置 codex-lark-remote。

飞书应用：
- appId: cli_xxx
- appSecret: xxx
- verificationToken: xxx
- encryptKey: xxx

允许使用者：
- allowedUsers: ["ou_xxx"]

可选的远程编程仓库：
- defaultRepo: my-project
- repos.my-project.path: /absolute/path/to/my-project
- repos.my-project.baseBranch: main
- repos.my-project.testCommand: npm test

请写入 ~/.codex-lark-remote/config.json，然后运行 codex_lark_check_auth、
codex_lark_diagnose，最后在当前对话里启动 codex_lark_handoff。
```

注意：

- WebSocket 长连接和消息回复需要 `appId` 与 `appSecret`。
- `verificationToken` 与 `encryptKey` 主要用于 webhook fallback 或加密事件校验，但保留配置会更完整。
- `allowedUsers` 应包含飞书/Lark sender id。如果还不知道自己的 sender id，可以首次配置时先留空，从飞书向机器人发送 `/codex whoami`，再把返回的 `senderId` 加进去。
- 只有当你希望飞书/Lark 为某个目标项目创建隔离 worktree 编程任务时，才必须配置 `repos`。当前线程 handoff 只需要飞书/Lark 应用凭据和 allowlist 就能工作。
- 只把 secrets 粘贴到可信的本地 Codex 对话里。不要通过飞书聊天发送 secrets，也不要提交 `~/.codex-lark-remote/config.json`。

等价的 JSON 结构如下：

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
  "defaultRepo": "my-project",
  "repos": {
    "my-project": {
      "path": "/absolute/path/to/my-project",
      "remote": "origin",
      "baseBranch": "main",
      "testCommand": "npm test"
    }
  }
}
```

## 启动当前线程 handoff

在 Codex 聊天里，让 agent 为当前对话启动插件：

```text
启动 codex-lark-remote handoff，让我接下来可以从飞书继续这个 Codex 对话。
```

Codex 应该调用：

- `codex_lark_check_auth`
- `codex_lark_diagnose`
- `codex_lark_handoff`

在飞书事件订阅里选择长连接，并添加 `im.message.receive_v1`。默认 WebSocket 路径不需要公网 callback URL。

当 `codex_lark_handoff` 在已经打开的 Codex 对话里被调用时，它会把当前本地 Codex thread 写入 `~/.codex-lark-remote/handoff.json`。之后普通飞书/Lark 消息会通过 `codex exec resume <thread_id>` 继续该对话，让模型可见上下文延续自当前 Codex 会话。handoff 模式下，普通飞书/Lark 文本会作为直接的 Codex 用户消息发送，机器人回复最终 Codex 回答。这是后端 resume 路线，不是把文字输入到 Codex Desktop 的 UI 输入框。

如果不通过飞书/Lark，本地也可以手动创建任务测试：

```text
codex_lark_send prompt="fix the failing test" repoKey="example"
```

bridge 暴露了一个 loopback HTTP API 给 MCP 工具使用，同时保留 `/bridge/lark/event` 作为 webhook fallback 和测试入口。如果把 `lark.transport` 设置为 `webhook`，需要在这个路由前放可信 tunnel 或反向代理。

本地模拟飞书/Lark 消息：

```bash
npm run fixture -- --text "[codex-lark-remote] local fixture task"
npm run fixture -- --sign --encrypt --text "[codex-lark-remote] encrypted fixture task"
```

模拟 URL verification：

```bash
npm run fixture -- --sign --encrypt --challenge
```

正常 WebSocket 路径下，在 `codex_lark_handoff` 报告 bridge 正在运行后，直接发送飞书消息即可。Webhook fallback 下，设置 `CODEX_LARK_PUBLIC_URL` 或 `publicUrl`，然后使用 `codex_lark_diagnose` 返回的 webhook URL。

### Worker 运行说明

Worktree 任务默认使用 `codex exec --ignore-user-config`。这样可以让子 Codex 进程专注于任务 worktree，并避免加载同一个飞书/Lark 插件作为嵌套 MCP server。只有当 worker 必须加载你个人 Codex 配置中的工具时，才把 `runner.ignoreUserConfig` 设置为 `false`。

当前线程 handoff 使用 `codex exec resume --ignore-user-config <thread_id>`。默认情况下，飞书/Lark 文本会直接作为下一条 Codex 用户消息传入。该路线会保留磁盘上的 Codex session history，并把 `--output-last-message` 捕获到的最终 assistant message 回复给飞书。只有当你希望每个 resumed turn 显式带上飞书/Lark 来源标记时，才把 `handoff.promptStyle` 设置为 `annotated`。

每个任务都会在队列中记录通知投递元数据。如果飞书/Lark 接受了 HTTP 请求但返回非零 API `code`，任务会记录 `lastNotifyError`，可以用 `/codex status rcmd_xxx` 查看完整结果。

## 聊天命令

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

Commit 和 push 永远不会自动执行。只有收到明确 approve 命令后，它们才会在任务 worktree/branch 中运行。
