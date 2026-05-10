# Codex Lark Remote

从飞书/Lark 继续当前 Codex 对话。

English version: [README.md](README.md)

这份 README 会随可安装的 Codex 插件包一起发布。仓库首页也保留了一份完整的首次安装说明。

## 默认流程

Codex Lark Remote 只围绕一个默认流程设计：从当前 Codex 对话启动，明确同意接管，
然后从飞书/Lark 继续同一个对话。

飞书/Lark 消息会作为普通用户消息交给 Codex。机器人会把最终回答和执行过程中的关键
进度发回飞书/Lark。

## 从 Codex 安装

在 Codex 的插件市场设置里打开“添加插件市场”，按下面填写：

```text
来源：
https://github.com/GxFn/codex-lark-remote.git

Git 引用：
main

稀疏路径：
留空
```

添加后，在插件列表里启用 `codex-lark-remote`。如果要固定版本，可以把“Git 引用”
改成具体 release tag，例如 `v0.1.13`。

## 配置飞书/Lark

创建飞书/Lark 应用：

1. 打开 [飞书开放平台](https://open.feishu.cn/) 或
   [Lark Open Platform](https://open.larksuite.com/)。
2. 创建企业自建应用/内部应用。
3. 启用机器人能力。
4. 在“凭证与基础信息”里复制 **App ID** 和 **App Secret**。
5. 在“事件订阅”里选择长连接/WebSocket，并订阅 `im.message.receive_v1`。
6. 按平台提示启用消息接收和回复权限，然后发布或启用应用。

把配置粘贴到可信的本地 Codex 对话里：

```text
请配置 codex-lark-remote。

飞书应用：
- appId: cli_xxx
- appSecret: xxx

允许使用者：
- allowedUsers: ["ou_xxx"]

请用这些值调用 codex_lark_configure，然后运行 codex_lark_check_auth。
```

私密配置会写到仓库外：

```text
~/.codex-lark-remote/config.json
```

如果还不知道自己的 sender id，可以先让 `allowedUsers` 为空，从飞书/Lark 向机器人
发送 `/codex whoami`，再把返回的 `senderId` 加入配置。

缺少 `appId` 或 `appSecret` 时，bridge 不会启动。

## 启动接管

在你想从飞书/Lark 继续的 Codex 对话里说：

```text
启动 codex-lark-remote。
```

Codex 必须先请求你的明确同意，才会启动接管。确认后，插件会把当前 Codex 线程挂到
本地 bridge。

之后直接给飞书/Lark 机器人发送普通消息即可，它会继续同一个 Codex 对话。

在 macOS 上，接管还会启动 `caffeinate -dimsu`，让屏幕可以熄灭但 Mac 保持唤醒。
关闭接管或停止 bridge 时，这个 keep-awake 进程会一起停止。

常用命令：

```text
/codex whoami
/codex status
/codex handoff off
```

“断开连接”“停止接管”这类口语请求也会被处理。

## 飞书/Lark 输出

远程回复会针对手机和聊天场景做优化：

- 进度消息不再额外显示 `Codex progress` 标题。
- 普通进度回复不展示内部 task id。
- 长回复会拆成多条飞书/Lark 消息。
- 有价值的输出会保留换行。
- `cat`、`nl`、`sed`、`grep`、普通 `rg` 搜索这类源码查看输出会被摘要化。
- 测试结果、错误、warning、git 摘要等高价值输出会保留。

## Mac 保持唤醒

默认启用：

```json
{
  "handoff": {
    "keepAwake": true,
    "keepAwakeCommand": "caffeinate",
    "keepAwakeArgs": ["-dimsu"]
  }
}
```

如果要关闭，可以在 `~/.codex-lark-remote/config.json` 里把 `handoff.keepAwake`
设为 `false`。这个功能只在 macOS 上运行。

## 排查

当前没有 `codex_lark_*` 工具：

说明这个 Codex 对话没有加载插件 MCP server。刷新或重新启用插件后，新开一个 Codex
对话再启动。正常启动不应该退回到本地脚本。

`/codex status` 显示 `websocket disabled`：

检查 `~/.codex-lark-remote/config.json`，确认已经存在 `appId` 和 `appSecret`。

同一条飞书/Lark 消息收到两次回复：

停止旧 bridge 进程或重复插件安装，然后重新启动接管。

Codex 改到了插件缓存目录：

请从目标项目所在的 Codex 对话里启动接管。

## 本地开发

把这个仓库注册为 local marketplace：

```toml
[marketplaces.gxfn]
source_type = "local"
source = "/absolute/path/to/codex-lark-remote"

[plugins."codex-lark-remote@gxfn"]
enabled = true
```

运行测试：

```text
npm test
```
