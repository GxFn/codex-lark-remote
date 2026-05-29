<div align="center">

# Lark Remote

从飞书/Lark 控制、观察并接管本机 Codex 会话。

[![Codex Marketplace](https://img.shields.io/badge/Codex%20Marketplace-codex--lark--remote-blue?style=flat-square)](https://www.codex-marketplace.com/plugins/codex-lark-remote)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square)](https://nodejs.org)

[English](README.md)

</div>

---

- [为什么需要](#为什么需要) - [安装](#安装) - [快速开始](#快速开始) - [配置飞书/Lark](#配置飞书lark) - [先从控制台开始](#先从控制台开始) - [从 Codex 启动](#从-codex-启动) - [工作方式](#工作方式) - [行为与边界](#行为与边界) - [仓库结构](#仓库结构) - [开发](#开发)

## 为什么需要

Codex 最适合在本机项目里工作，但你不一定一直坐在运行 Codex Desktop 的 Mac 前。
Lark Remote 让 Codex 继续留在本地运行，把飞书/Lark 变成一个轻量远程控制台。

默认产品形态刻意收窄：

```text
Codex Desktop 会话
   |
   v
本地 Lark Remote bridge
   |
   v
飞书/Lark 机器人与控制台
   |
   v
观察、选择或接管本机 Codex 会话
```

bridge 是 local-first 的。启动时不会把已有 Codex 聊天历史发送到飞书/Lark。
项目/会话接管需要先配置允许用户，Codex 原生权限弹窗也仍然留在 Mac 上处理。

这个仓库是 `gxfn` Codex 插件 marketplace 的源码。真正可安装的插件包位于
[`plugins/codex-lark-remote/`](plugins/codex-lark-remote/)。
仓库根 README 是完整首次使用指南；插件包内还有
[英文插件 README](plugins/codex-lark-remote/README.md) 和
[中文插件 README](plugins/codex-lark-remote/README.zh-CN.md)。

## 安装

首次安装不需要先 clone 这个仓库。

### Codex Marketplace CLI

安装已经审核的 marketplace 插件：

```bash
npx codex-marketplace add GxFn/codex-lark-remote/plugins/codex-lark-remote --plugin
```

如果要固定到当前审核版本：

```bash
npx codex-marketplace add https://github.com/GxFn/codex-lark-remote/tree/v0.2.6/plugins/codex-lark-remote --plugin
```

安装后如果 Codex 插件列表没有立刻刷新，重启或刷新 Codex。

### Codex Desktop GitHub 安装

如果 Codex 要求填写 GitHub target 或直接 artifact path，请填写插件包路径，
不要填写仓库根目录：

```text
https://github.com/GxFn/codex-lark-remote/tree/v0.2.6/plugins/codex-lark-remote
```

如果 Codex 弹窗把来源、Git 引用、稀疏路径拆开填写，请这样填：

```text
来源：
https://github.com/GxFn/codex-lark-remote.git

Git 引用：
v0.2.6

稀疏路径：
plugins/codex-lark-remote
```

安装后在插件列表里启用 `codex-lark-remote`。

### Marketplace 源

这个仓库也包含 `.agents/plugins/marketplace.json`。如果要添加整个 `gxfn`
marketplace，而不是只安装这个插件，可以使用仓库根目录并让稀疏路径留空。
只有在明确想使用未发布改动时，才使用 `main`。

## 快速开始

成功路径是：

1. 在 Codex 中安装并启用插件。
2. 创建飞书/Lark 内部应用，复制 App ID 和 App Secret。
3. 回到 Codex，说 `已复制` 或 `copied`；Codex 会读取剪贴板并调用
   `codex_lark_configure`。
4. 让 Codex 运行 `codex_lark_check_auth` 和 `codex_lark_verify_setup`。
5. 在 bridge 运行时，到飞书/Lark 开放平台验证长连接事件配置和回调配置。
6. 回到 Codex，明确同意把当前 Codex 会话连接到 Lark Remote。
7. 从飞书/Lark 给机器人发送 `whoami`，再把返回的 `senderId` 加入
   `lark.allowedUsers`。
8. 在飞书/Lark 发送 `控制台`，选择项目和会话，然后用 `接管 1` 或卡片按钮接管。

日常使用会更短：从可信 Codex 对话启动 Lark Remote，在飞书/Lark 打开控制台，
选择会话，接管生效后直接发送普通开发需求。

## 配置飞书/Lark

在要连接的平台创建机器人应用：

1. 打开 [飞书开放平台](https://open.feishu.cn/) 或
   [Lark Open Platform](https://open.larksuite.com/)。
2. 国内版飞书使用 `lark.domain: "feishu"`，这也是默认值。
   国际版 Lark 使用 `lark.domain: "lark"`。App ID/App Secret 必须来自同一个
   开放平台域名，飞书和 Lark 凭证不能混用。
3. 创建企业自建应用/内部应用。
4. 启用机器人能力。
5. 在“凭证与基础信息”里复制 **App ID** 和 **App Secret**。
6. 在“事件配置”里选择长连接/WebSocket，并订阅 `im.message.receive_v1`。
7. 在“回调配置”里选择长连接/WebSocket，并订阅 `card.action.trigger`。
   点击验证/保存时，需要 Lark Remote bridge 正在运行。
8. 按平台提示开通消息接收、发送/回复消息、卡片交互回调相关权限，然后发布或启用应用。

把凭证复制到剪贴板时，可以使用这个形状：

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

私密运行配置写在仓库外：

```text
~/.codex-lark-remote/config.json
```

不要提交这个文件。首次私有配置里，`allowedUsers: []` 只是临时发现身份的状态。
`whoami` 成功后，需要把返回的 sender id 加入允许列表，才能使用全项目/会话接管。

`startup.receiveId` 是可选主动推送目标。配置后，bridge 会主动向该会话发送启动介绍卡片。
未配置时，第一条已授权飞书/Lark 消息会提供 `chat_id`，收到一次启动介绍，并成为后续启动记住的目标。

## 先从控制台开始

飞书/Lark 侧最重要的入口是自然语言控制台。bridge 连上后，发送 `控制台`，
或点击启动卡片里的“控制台”。

控制台会按飞书/Lark 会话绑定展示语言：用中文进入就持续展示中文卡片；用英文进入
就展示英文卡片。之后发送另一种语言的控制口令，会切换该会话后续展示语言。

常用控制台口令：

```text
控制台
项目列表
会话列表
进入项目 1
观察会话 2
接管 1
status
whoami
commands on
commands off
退出接管
关闭飞书连接
```

同一套控制也支持英文：`console`, `project list`, `session list`,
`enter project 1`, `observe session 2`, `takeover 1`, `status`, and
`close Lark connection`.

接管后，飞书会话会进入任务直通模式。后续普通消息会直接发送给目标 Codex 会话，
作为新任务或补充指令处理，不再判断项目/会话操作，直到你回到控制台或退出接管。

## 从 Codex 启动

在可信的 Codex 对话里说：

```text
启动 codex-lark-remote。
```

Codex 会先请求你的明确同意，才会把这个线程的本地路由状态写入本地 bridge。
已有聊天历史不会发送到飞书/Lark。确认后，插件会启动或复用 bridge，并打开
飞书/Lark 控制链路。

当某个 Codex 线程被挂载或接管时，插件严格使用 Codex 提供的精确 thread id 或
session path，不会按工作目录猜测最近对话。bridge 连上后，你也可以从飞书/Lark
控制台切换到其他允许的本机会话。

在 macOS 上，接管期间 bridge 会启动 `caffeinate -dimsu`，让屏幕可以熄灭但 Mac
保持唤醒。如果想自己管理睡眠，可以在 `~/.codex-lark-remote/config.json` 里把
`handoff.keepAwake` 设为 `false`。

## 工作方式

### 本地 Bridge

插件 MCP server 运行在 Codex 内部，并启动一个独立本地 bridge 进程。bridge 负责
飞书/Lark WebSocket、事件解析、队列状态、启动提示、观察串流和接管路由。

### 目标选择

飞书/Lark 通过 `控制台`、`windows`、`项目列表` 和 `接管` 控制目标选择。机器人先从
本地 Codex session 记录列出项目，再列出某个项目内的会话/窗口。这里不是 macOS
窗口句柄枚举。

### 观察与接管

观察是只读的。使用 `observe`、`observe <序号>` 和 `observe off` 可以把另一个
Codex 会话的进度串流到飞书/Lark，但不会把飞书/Lark 输入路由进被观察会话。

接管在确认后具备写入能力。全项目接管要求 `lark.allowedUsers` 非空。仍在运行的
会话会进入 pending takeover，等目标 Codex 轮次空闲后再真正接管。

## 行为与边界

远程回复会按聊天里的编程场景精简：

- Codex 最终回答会作为普通文本发回飞书/Lark。
- 长回答会拆成多条飞书/Lark 消息。
- 普通进度回复默认不展示内部 task id。
- 普通命令和 `Output:` 默认隐藏。
- `commands on` 显示命令摘要；`commands off` 再次隐藏。
- 潜在风险命令始终会带 `Warning:` 展示。
- `cat`、`nl`、`sed`、`grep` 和普通 `rg` 这类源码查看输出会被摘要化。
- 命令中的 token、secret、password 等敏感内容会先脱敏。

Lark Remote 接管的是对话输入输出链路，不是 Codex Desktop 的原生 UI。飞书/Lark
不能点击权限弹窗、MCP 审批、沙箱提权、联网/安装依赖审批，或其他 Codex 原生 UI
弹窗。遇到这些边界时，Codex 应发回清晰的飞书/Lark 提示，说明需要什么权限以及在哪里批准。

如果目标 Codex Desktop 会话仍在执行，Lark Remote 不会把文本热注入正在运行的进程。
这条飞书/Lark 消息不会排队；请等接管生效提示出现，或当前 Codex 轮次结束后重新发送。

## 仓库结构

| 路径 | 用途 |
| --- | --- |
| `plugins/codex-lark-remote/` | 可安装的 Codex 插件包。 |
| `plugins/codex-lark-remote/bin/` | MCP server 和本地 bridge 入口。 |
| `plugins/codex-lark-remote/src/` | bridge、飞书/Lark、handoff、observer、presenter 和 runner 模块。 |
| `plugins/codex-lark-remote/skills/` | 随插件发布的 Codex skill 指令。 |
| `plugins/codex-lark-remote/config/example.config.json` | 私密运行配置示例。 |
| `docs/technical_architecture.zh-cn.md` | 技术架构文档。 |
| `docs/cross_thread_takeover_design.zh-cn.md` | 跨对话接管设计。 |
| `docs/intent_translator_design.zh-cn.md` | 飞书自然语言意图翻译设计。 |
| `test/` | Node 测试。 |
| `scripts/sync-gxfn-marketplace.mjs` | marketplace 快照同步脚本。 |

## 开发

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

发布或刷新插件后，把可安装插件根目录同步到聚合
`GxFn/GxFnCodexMarketplace` 仓库：

```bash
npm run sync:gxfn-marketplace
```

如果要让脚本同时复制、提交并推送市场快照，运行
`npm run sync:gxfn-marketplace:push`。如果 `GxFnCodexMarketplace` 没有和本仓库
放在同一层目录，用 `GXFN_CODEX_MARKETPLACE_DIR=/path/to/GxFnCodexMarketplace`
指定路径。

## 排查

| 现象 | 检查 |
| --- | --- |
| 当前没有 `codex_lark_*` 工具 | 刷新或重新启用插件，然后新开一个 Codex 对话。 |
| `status` 显示 `websocket disabled` | 检查 `~/.codex-lark-remote/config.json` 里的 `appId`、`appSecret` 和 `lark.domain`。 |
| 同一条飞书/Lark 消息收到两次回复 | 停止旧 bridge 进程或重复插件安装。 |
| Codex 改到了插件缓存目录 | 从目标项目所在的 Codex 对话里启动接管。 |
| 国际版用户鉴权失败 | 使用 `lark.domain: "lark"`，并使用 `https://open.larksuite.com` 的凭证。 |
