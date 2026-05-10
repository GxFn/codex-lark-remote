# Codex Lark Remote

从飞书/Lark 继续当前 Codex 对话。

English version: [README.md](README.md)

默认体验只有一件事：在已经打开的 Codex 对话里启动插件，然后离开 Mac，用飞书/Lark
继续接管这个对话。飞书/Lark 消息会作为普通用户消息交给 Codex，机器人把最终回答发回飞书/Lark。

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

添加市场后，在插件列表里启用 `codex-lark-remote`。发布 tag 之后，可以把“Git 引用”改成具体版本号，例如 `v0.1.6`。

## 配置

先在本地 Codex 对话里说：

```text
启动 codex-lark-remote，并帮我配置飞书远程接管。
```

如果还没有飞书/Lark 应用凭据：

1. 打开 [飞书开放平台](https://open.feishu.cn/) 或
   [Lark Open Platform](https://open.larksuite.com/)。
2. 创建企业自建应用/内部应用。
3. 启用机器人能力。
4. 在“凭证与基础信息”里复制 **App ID** 和 **App Secret**。
5. 在“事件订阅”里选择长连接/WebSocket，并订阅 `im.message.receive_v1`。
6. 按平台提示开通消息接收/回复相关权限，然后发布或启用应用。

把凭据粘贴到可信的本地 Codex 对话里：

```text
请配置 codex-lark-remote。

飞书应用：
- appId: cli_xxx
- appSecret: xxx

允许使用者：
- allowedUsers: ["ou_xxx"]

请用这些值调用 codex_lark_configure，然后运行 codex_lark_check_auth，
并为当前 Codex 对话启动 codex_lark_handoff。
```

插件默认把私密运行配置写到 `~/.codex-lark-remote/config.json`。不要提交这个文件。
如果还不知道自己的飞书/Lark sender id，可以首次配置时先让 `allowedUsers` 为空，从飞书向机器人发送 `/codex whoami`，再把返回的 `senderId` 加进去。

缺少 `appId` 或 `appSecret` 时，插件不会启动本地 bridge，也不会接管当前 Codex 对话；它只会返回上面的配置步骤。

## 使用

在你想远程继续的 Codex 对话里说：

```text
启动 codex-lark-remote。
```

启动成功后，直接给飞书/Lark 机器人发送普通消息即可。Codex 会继续同一个对话，并把回答发回飞书/Lark。

常用飞书/Lark 命令：

```text
/codex whoami
/codex status
/codex handoff off
```

如果 Codex 提示当前没有 `codex_lark_*` 工具，说明这个对话没有加载插件 MCP
server。刷新或重新启用插件后，新开一个 Codex 对话再启动。正常启动不应该退回到本地脚本。

本地开发时，可以把这个仓库注册为 local marketplace：

```toml
[marketplaces.gxfn]
source_type = "local"
source = "/absolute/path/to/codex-lark-remote"

[plugins."codex-lark-remote@gxfn"]
enabled = true
```
