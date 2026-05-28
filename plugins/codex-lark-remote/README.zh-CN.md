<div align="center">

# Lark Remote

从飞书/Lark 控制、观察并接管本机 Codex 会话。

[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square)](https://nodejs.org)

[English](README.md)

</div>

---

- [为什么需要](#为什么需要) - [安装](#安装) - [快速开始](#快速开始) - [配置飞书/Lark](#配置飞书lark) - [控制台与接管](#控制台与接管) - [运行行为](#运行行为) - [插件包结构](#插件包结构) - [开发](#开发)

## 为什么需要

这份 README 会随可安装的 Codex 插件包一起发布。Lark Remote 让 Codex 继续在本机运行，
同时把飞书/Lark 变成管理本机 Codex 项目和会话的远程控制面。

```text
Codex 对话
   |
   v
本地 bridge
   |
   v
飞书/Lark 控制台
   |
   v
观察或接管选中的 Codex 会话
```

启动 bridge 的 Codex 对话可以作为初始目标，但 bridge 连上后，飞书/Lark 也可以列出项目、
选择其他会话、只读观察进度，或确认后接管某个 Codex 会话。

## 安装

安装已经审核的 Codex Marketplace 插件：

```bash
npx codex-marketplace add GxFn/codex-lark-remote/plugins/codex-lark-remote --plugin
```

如果要固定到当前审核版本：

```bash
npx codex-marketplace add https://github.com/GxFn/codex-lark-remote/tree/v0.2.5/plugins/codex-lark-remote --plugin
```

如果 Codex 要求填写 GitHub target 或直接 artifact path，请填写：

```text
https://github.com/GxFn/codex-lark-remote/tree/v0.2.5/plugins/codex-lark-remote
```

如果 Codex 弹窗把来源、Git 引用、稀疏路径拆开填写，请这样填：

```text
来源：
https://github.com/GxFn/codex-lark-remote.git

Git 引用：
v0.2.5

稀疏路径：
plugins/codex-lark-remote
```

安装后在插件列表里启用 `codex-lark-remote`。如果要添加整个 `gxfn` 仓库
marketplace，而不是只安装这个插件，可以使用仓库根目录并让稀疏路径留空。
只有在明确想使用未发布改动时，才使用 `main`。

## 快速开始

推荐首次流程：

1. 创建飞书/Lark 应用，并复制 App ID/App Secret。
2. 回到 Codex，说 `已复制` 或 `copied`。
3. Codex 读取剪贴板，用 `codex_lark_configure` 保存配置，然后运行
   `codex_lark_check_auth`。
4. Codex 运行 `codex_lark_verify_setup`，确保 bridge 已连接，再去开放平台验证页面。
5. 验证长连接事件配置和回调配置。
6. 回到 Codex，明确同意连接当前会话。
7. 从飞书/Lark 发送 `whoami`，把返回的 sender id 加入 `lark.allowedUsers`。
8. 从飞书/Lark 发送 `控制台`，选择项目和会话。

缺少 `appId` 或 `appSecret` 时，bridge 不会启动。

## 配置飞书/Lark

在要连接的平台创建应用：

1. 打开 [飞书开放平台](https://open.feishu.cn/) 或
   [Lark Open Platform](https://open.larksuite.com/)。
2. 国内版飞书使用 `lark.domain: "feishu"`，这也是默认值。
   国际版 Lark 使用 `lark.domain: "lark"`。应用凭证必须来自同一个开放平台域名。
3. 创建企业自建应用/内部应用。
4. 启用机器人能力。
5. 在“凭证与基础信息”里复制 **App ID** 和 **App Secret**。
6. 在“事件配置”里选择长连接/WebSocket，并订阅 `im.message.receive_v1`。
7. 在“回调配置”里选择长连接/WebSocket，并订阅 `card.action.trigger`。
8. 按平台提示启用消息接收、发送/回复消息、卡片交互回调权限，然后发布或启用应用。

剪贴板形状：

```text
飞书应用：
- domain: feishu
- appId: cli_xxx
- appSecret: xxx

允许使用者：
- allowedUsers: []

可选接管参数：
- takeover: { projectLimit: 20, selectionTtlMs: 600000 }

可选启动介绍：
- startup: { receiveId: "oc_xxx", receiveIdType: "chat_id", once: true }
```

如果配置国际版 Lark，把 `domain` 改成 `lark`，并使用
`https://open.larksuite.com` 创建出来的 App ID/App Secret。

私密配置写在仓库外：

```text
~/.codex-lark-remote/config.json
```

首次私有配置时，`allowedUsers: []` 只用于发现身份。`whoami` 成功后，把自己的
sender id 加入允许列表，再使用项目/会话接管。

## 控制台与接管

bridge 连上后，发送 `控制台`，或点击启动卡片里的控制台按钮。

常用口令：

```text
控制台
项目列表
会话列表
进入项目 1
观察会话 2
接管 1
status
whoami
退出接管
关闭飞书连接
```

英文口令也可用：`console`, `project list`, `session list`,
`enter project 1`, `observe session 2`, `takeover 1`, `status`, and
`close Lark connection`.

观察是只读串流，和接管分开。使用 `observe`、`observe <序号>` 或
`observe <thread 前缀>` 可以把选中的会话进度串流到飞书/Lark。使用
`observe off` 停止观察。

接管在确认后具备写入能力。飞书/Lark 会先展示本机 Codex 项目，再展示所选项目内的
会话/窗口。这里基于本机 Codex session 记录，不是 macOS 窗口句柄。仍在运行的会话会等
空闲后接管；这期间发送的飞书/Lark 消息不会排队，请等接管生效提示出现后再发。

## 运行行为

远程回复会针对手机和聊天场景做优化：

- 进度消息不额外显示标题。
- 普通进度回复不展示内部 task id。
- 长回复会拆成多条飞书/Lark 消息。
- 普通命令和 `Output:` 默认隐藏。
- `commands on` 显示命令摘要；`commands off` 再次隐藏。
- 潜在风险命令始终会带 `Warning:` 展示。
- `cat`、`nl`、`sed`、`grep` 或普通 `rg` 搜索输出会被摘要化。
- 命令里的 token、secret、password 等敏感内容会先脱敏。

Lark Remote 控制的是对话输入输出链路，不是 Codex Desktop 原生 UI。飞书/Lark
不能点击权限弹窗、MCP 审批、沙箱提权、联网/安装依赖审批，或其他原生 UI 弹窗。
需要这些审批时，agent 应在飞书/Lark 里清楚说明需要什么权限以及在哪里批准。

macOS 上默认会在接管期间启动 `caffeinate -dimsu`。如果要关闭，在私密配置里把
`handoff.keepAwake` 设为 `false`。

## 插件包结构

| 路径 | 用途 |
| --- | --- |
| `.codex-plugin/` | Codex 插件 manifest。 |
| `.mcp.json` | 插件 MCP server 声明。 |
| `bin/` | MCP server 和本地 bridge 入口。 |
| `src/` | bridge、飞书/Lark、handoff、observer、presenter 和 runner 模块。 |
| `skills/` | Codex skill 指令。 |
| `config/example.config.json` | 私密运行配置示例。 |
| `README.md` | 英文插件包说明。 |
| `README.zh-CN.md` | 中文插件包说明。 |

## 开发

本地开发时，可以把这个仓库注册为 local marketplace：

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

## 排查

| 现象 | 检查 |
| --- | --- |
| 当前没有 `codex_lark_*` 工具 | 刷新或重新启用插件，然后新开一个 Codex 对话。 |
| `status` 显示 `websocket disabled` | 检查 `~/.codex-lark-remote/config.json` 里的 `appId`、`appSecret` 和 `lark.domain`。 |
| 同一条飞书/Lark 消息收到两次回复 | 停止旧 bridge 进程或重复插件安装。 |
| Codex 改到了插件缓存目录 | 从目标项目所在的 Codex 对话里启动接管。 |
| 国际版 Lark 鉴权失败 | 使用 `lark.domain: "lark"`，并使用 `https://open.larksuite.com` 的凭证。 |
