# Codex Lark Remote

从飞书/Lark 继续当前 Codex 对话。

English version: [README.md](README.md)

这个仓库是 `gxfn` Codex 插件 marketplace。真正可安装的插件包位于
[`plugins/codex-lark-remote/`](plugins/codex-lark-remote/)。
仓库根目录也保留一份完整 README，方便首次安装用户在 GitHub 首页直接了解安装、配置和使用方式。

插件包随附文档：

- [英文插件 README](plugins/codex-lark-remote/README.md)
- [中文插件 README](plugins/codex-lark-remote/README.zh-CN.md)

## 功能

Codex Lark Remote 让你在一个已经打开的 Codex 对话里启动接管，然后离开 Mac，
直接从飞书/Lark 继续同一个 Codex 对话。飞书/Lark 消息会作为普通用户消息交给
Codex，机器人会把最终回答和长任务过程中的关键进度发回飞书/Lark。

默认路径刻意保持简单：一个当前 Codex 对话、一个飞书/Lark 机器人、WebSocket
优先连接。正常使用时不要求用户理解或选择多种模式。

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

添加市场后，在插件列表里启用 `codex-lark-remote`。发布 tag 之后，可以把“Git
引用”改成具体版本号，例如 `v0.1.10`。

## 配置飞书/Lark

如果还没有飞书/Lark 应用凭据：

1. 打开 [飞书开放平台](https://open.feishu.cn/) 或
   [Lark Open Platform](https://open.larksuite.com/)。
2. 创建企业自建应用/内部应用。
3. 启用机器人能力。
4. 在“凭证与基础信息”里复制 **App ID** 和 **App Secret**。
5. 在“事件订阅”里选择长连接/WebSocket，并订阅 `im.message.receive_v1`。
6. 按平台提示开通消息接收/回复相关权限，然后发布或启用应用。

在可信的本地 Codex 对话里粘贴必要配置：

```text
请配置 codex-lark-remote。

飞书应用：
- appId: cli_xxx
- appSecret: xxx

允许使用者：
- allowedUsers: ["ou_xxx"]

请用这些值调用 codex_lark_configure，然后运行 codex_lark_check_auth。
```

插件默认把私密运行配置写到 `~/.codex-lark-remote/config.json`。不要提交这个文件。
如果还不知道自己的飞书/Lark sender id，可以首次配置时先让 `allowedUsers` 为空，
从飞书向机器人发送 `/codex whoami`，再把返回的 `senderId` 加进去。

缺少 `appId` 或 `appSecret` 时，插件不会启动本地 bridge，也不会接管当前 Codex
对话；它只会返回配置指引。

## 启动接管

在你想远程继续的 Codex 对话里说：

```text
启动 codex-lark-remote。
```

Codex 会先要求你明确同意，把当前对话和必要路由元数据交给本地插件 bridge。
确认后，插件会启动 bridge、挂载当前 Codex 线程，并等待飞书/Lark 消息。

启动成功后，直接给飞书/Lark 机器人发送普通消息即可。Codex 会继续同一个对话，
并把回答发回飞书/Lark。

常用飞书/Lark 命令：

```text
/codex whoami
/codex status
/codex handoff off
```

机器人也会识别“断开连接”“停止接管”等自然语言请求。

## 排查

如果 Codex 提示当前没有 `codex_lark_*` 工具，说明这个对话没有加载插件 MCP
server。刷新或重新启用插件后，新开一个 Codex 对话再启动。正常启动应该使用插件
MCP 工具，而不是退回到本地 shell 脚本。

如果 `/codex status` 显示 `websocket disabled`，请确认
`~/.codex-lark-remote/config.json` 中已经存在 `appId` 和 `appSecret`，然后从
Codex 重新启动接管。

如果同一条飞书/Lark 消息收到两次回复，通常是旧 bridge 进程或重复安装还在运行。
先停止旧进程或重复插件，再重新启动。

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
