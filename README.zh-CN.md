# Codex Lark Remote

从飞书/Lark 继续当前 Codex 对话。

English version: [README.md](README.md)

这个仓库是 `gxfn` Codex 插件 marketplace。真正可安装的插件包位于
[`plugins/codex-lark-remote/`](plugins/codex-lark-remote/)。
仓库根目录保留完整 README，方便首次安装用户在 GitHub 首页直接了解产品。

插件包随附文档：

- [英文插件 README](plugins/codex-lark-remote/README.md)
- [中文插件 README](plugins/codex-lark-remote/README.zh-CN.md)

## 概览

Codex Lark Remote 可以把一个正在进行的 Codex 对话交给飞书/Lark 接管。你可以在
Mac 上启动接管，然后离开电脑，继续从飞书/Lark 给同一个 Codex 线程发消息。

默认体验刻意收窄：

- 从你想继续的 Codex 对话里启动。
- 明确同意把当前对话交给本地 bridge。
- 直接给飞书/Lark 机器人发送普通消息。
- 在飞书/Lark 收到 Codex 的最终回答和关键进度。

飞书/Lark 消息会作为普通用户消息进入同一个 Codex 对话。插件默认 WebSocket
优先，正常使用时不要求用户理解或选择多种模式。

## 安装

首次安装用户不需要先 clone 这个仓库。在 Codex 的插件市场设置里打开“添加插件市场”，按下面填写：

```text
来源：
https://github.com/GxFn/codex-lark-remote.git

Git 引用：
main

稀疏路径：
留空
```

添加市场后，在插件列表里启用 `codex-lark-remote`。如果要安装固定版本，可以把
“Git 引用”改成具体 release tag，例如 `v0.1.15`。

## 配置飞书/Lark

先创建飞书/Lark 机器人应用：

1. 打开 [飞书开放平台](https://open.feishu.cn/) 或
   [Lark Open Platform](https://open.larksuite.com/)。
2. 创建企业自建应用/内部应用。
3. 启用机器人能力。
4. 在“凭证与基础信息”里复制 **App ID** 和 **App Secret**。
5. 在“事件订阅”里选择长连接/WebSocket，并订阅 `im.message.receive_v1`。
6. 按平台提示开通消息接收和回复相关权限，然后发布或启用应用。

然后把配置粘贴到可信的本地 Codex 对话里：

```text
请配置 codex-lark-remote。

飞书应用：
- appId: cli_xxx
- appSecret: xxx

允许使用者：
- allowedUsers: ["ou_xxx"]

请用这些值调用 codex_lark_configure，然后运行 codex_lark_check_auth。
```

插件默认把私密运行配置写到：

```text
~/.codex-lark-remote/config.json
```

不要提交这个文件。

如果还不知道自己的飞书/Lark sender id，可以首次配置时先让 `allowedUsers` 为空，
从飞书向机器人发送 `/codex whoami`，再把返回的 `senderId` 加进去。

缺少 `appId` 或 `appSecret` 时，插件不会启动 bridge，也不会接管当前 Codex 对话；
它只会返回配置指引。

## 启动接管

在你想远程继续的 Codex 对话里说：

```text
启动 codex-lark-remote。
```

Codex 会先要求你明确同意，然后只把当前线程的本地路由状态写入本地 bridge；
已有聊天历史不会发送到飞书/Lark。确认后，插件会启动 bridge、挂载当前 Codex 线程，
并等待飞书/Lark 消息。

启动成功后，直接给飞书/Lark 机器人发送普通消息即可。Codex 会继续同一个对话，
并把回答发回飞书/Lark。

在 macOS 上，bridge 会在接管期间自动启动 `caffeinate -dimsu`，允许屏幕熄灭但防止
Mac 睡眠。关闭接管或停止 bridge 时，这个 keep-awake 进程会一起停止。

常用飞书/Lark 命令：

```text
/codex whoami
/codex status
/codex handoff off
```

机器人也会识别“停止接管”“断开连接”等自然语言请求。

## 输出策略

飞书/Lark 回复会按远程编程场景做精简：

- Codex 最终回答会作为普通文本发回飞书/Lark。
- 长回答会拆成多条飞书/Lark 消息，而不是直接截断。
- 进度消息默认不展示内部 task id。
- 命令本身会显示，便于远程审计；潜在风险命令会额外显示 `Warning:`。
- 命令 `Output:` 只保留一行高价值摘要，省略时附带行数和字符数。
- `cat`、`nl`、`sed`、`grep`、普通 `rg` 搜索这类源码查看输出会被摘要化，
  避免大段源码刷屏。
- 命令里的 token、secret、password 等敏感内容会先脱敏。

这样飞书/Lark 里看到的是 Codex 做了什么、改了什么、哪里需要注意，而不是整屏源码。

## Mac 保持唤醒

默认 handoff 配置会在远程接管期间保持 Mac 唤醒：

```json
{
  "handoff": {
    "keepAwake": true,
    "keepAwakeCommand": "caffeinate",
    "keepAwakeArgs": ["-dimsu"]
  }
}
```

如果你想自己管理睡眠，可以在 `~/.codex-lark-remote/config.json` 里把
`handoff.keepAwake` 设为 `false`。这个功能只在 macOS 上运行。

## 排查

如果 Codex 提示当前没有 `codex_lark_*` 工具，说明这个对话没有加载插件 MCP
server。刷新或重新启用插件后，新开一个 Codex 对话再启动。正常启动应该使用插件
MCP 工具，而不是退回到本地 shell 脚本。

如果 `/codex status` 显示 `websocket disabled`，请确认
`~/.codex-lark-remote/config.json` 中已经存在 `appId` 和 `appSecret`，然后从
Codex 重新启动接管。

如果同一条飞书/Lark 消息收到两次回复，通常是旧 bridge 进程或重复安装还在运行。
先停止旧进程或重复插件，再重新启动。

如果 Codex 把文件写进插件缓存目录，请从目标项目所在的 Codex 对话里启动接管。

## 本地开发

本地开发时，可以把这个仓库注册为 local marketplace：

```toml
[marketplaces.gxfn]
source_type = "local"
source = "/absolute/path/to/codex-lark-remote"

[plugins."codex-lark-remote@gxfn"]
enabled = true
```

发布前运行测试：

```text
npm test
```
