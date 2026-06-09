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

这个仓库是自包含的 Codex 插件 marketplace 源码。仓库根目录就是可安装的
Codex 插件根目录，层级和 Wakeflow 保持一致。

## 安装

首次安装不需要先 clone 这个仓库。

### Codex Marketplace CLI

安装已经审核的 marketplace 插件：

```bash
npx codex-marketplace add GxFn/codex-lark-remote --plugin
```

如果要固定到当前审核版本：

```bash
npx codex-marketplace add https://github.com/GxFn/codex-lark-remote/tree/v0.2.7 --plugin
```

安装后如果 Codex 插件列表没有立刻刷新，重启或刷新 Codex。

### Codex Desktop GitHub 安装

如果 Codex 要求填写 GitHub target 或直接 artifact path，请填写仓库根目录：

```text
https://github.com/GxFn/codex-lark-remote/tree/v0.2.7
```

如果 Codex 弹窗把来源、Git 引用、稀疏路径拆开填写，请这样填：

```text
来源：
https://github.com/GxFn/codex-lark-remote.git

Git 引用：
v0.2.7

稀疏路径：
留空
```

安装后在插件列表里启用 `codex-lark-remote`。

### Marketplace 源

这个仓库包含 `.agents/plugins/marketplace.json`。它声明 `codex-lark-remote`
marketplace，里面只有一个指向仓库根目录的插件条目。只有在明确想使用未发布
改动时，才使用 `main`。

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

接管后，飞书会话会进入线程派发模式。后续普通消息会发送给专用 Codex 控制窗口，
作为所选目标会话的派发请求。JavaScript 不会直接把普通消息发送到目标线程；真正
的线程派发由控制窗口通过 Codex 宿主线程工具和 Lark Remote MCP 工具完成。

控制窗口连接后，JavaScript 只拦截 `控制台`、`status`、`observe off`、
`exit handoff`、`关闭飞书连接`、`控制:` / `control:` 这类明确控制关键词。
其他内容，包括项目/会话语义和 `派发:` / `dispatch:` 文本，都会原样交给控制
Codex 窗口，由 agent 基于 skill 和 MCP 工具自行判断。

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
窗口句柄枚举。开启 Lark Remote 连接的 Codex 会话就是专用控制窗口；飞书/Lark 后续
再从控制台选择另一个允许的本地会话作为观察或接管目标。

### 观察与接管

观察是只读的。使用 `observe`、`observe <序号>` 和 `observe off` 可以把另一个
Codex 会话的进度串流到飞书/Lark，但不会把飞书/Lark 输入路由进被观察会话。
观察回复会把新追加的用户提示词也作为 `用户提示：` 分隔消息发到飞书，避免多轮
LLM 输出在聊天里连成一段。

接管在确认后具备写入能力。全项目接管要求 `lark.allowedUsers` 非空。普通
飞书/Lark 消息会发送到专用 Codex 控制窗口，由控制窗口作为所选目标的线程派发
请求处理；如果目标会话正在运行，也应作为更高优先级的派发/打断请求正常投递，而
不是因为目标繁忙失败。控制窗口连接后，JS 入口只拦截 `控制台`、`status`、
`observe off`、`exit handoff`、`关闭飞书连接`、`控制:` / `control:` 这类明确
控制关键词；其他内容，包括项目/会话语义和 `派发:` / `dispatch:` 文本，都会原样
交给控制 Codex 窗口，由 agent 基于 skill 和 MCP 工具自行判断。接管期间，
飞书/Lark 端自己发给 Codex 控制窗口的提示词不会再回显；如果目标窗口出现非
飞书来源的新提示词，例如自动化或本地 Codex 输入，会作为 `用户提示：` 分隔消息
同步到飞书。

控制 Codex 窗口可以通过 `codex_lark_context`、
`codex_lark_takeover_projects`、`codex_lark_takeover_project`、
`codex_lark_takeover_targets`、`codex_lark_takeover`、
`codex_lark_takeover_clear`、`codex_lark_observation_targets`、
`codex_lark_observe` 和 `codex_lark_observe_stop` 等 MCP 工具检查和改变
Lark Remote 状态。随插件发布的 Lark Remote Control Window skill 会提示控制窗口
优先结合这些工具和 Codex 宿主线程工具判断，而不是只靠 JS 侧猜语义。

接管是可写的，但普通飞书/Lark 消息不会直接进入目标会话；它们会先进入开启连接的
Codex 控制窗口，再由控制窗口使用 Codex 宿主线程工具派发到选中的目标会话。

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

如果所选目标 Codex 会话仍在执行，Lark Remote 仍会把飞书/Lark 消息发送给专用
Codex 控制窗口。控制窗口应把它当成目标线程的更高优先级派发/打断请求处理；只有
宿主线程工具不可用、目标线程无法定位，或无法验证投递/读回时才 fail closed。

## 仓库结构

| 路径 | 用途 |
| --- | --- |
| `./` | 可安装的 Codex 插件包。 |
| `bin/` | MCP server 和本地 bridge 入口。 |
| `src/` | bridge、飞书/Lark、handoff、observer、presenter 和 runner 模块。 |
| `skills/` | 随插件发布的 Codex skill 指令。 |
| `config/example.config.json` | 私密运行配置示例。 |
| `test/` | Node 测试。 |

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
npm run prepare:codex-plugin-runtime
npm test
```

Codex 插件根目录会通过一个小 wrapper 和 `runtime.tgz` 启动 MCP。
这个 runtime 包会把 `@larksuiteoapi/node-sdk` 这类 npm 依赖一起封进去，
因此已安装的插件缓存不需要直接带一个展开的 `node_modules/` 目录。依赖或运行
入口变化后，需要重新生成 `runtime.tgz`。


## 排查

| 现象 | 检查 |
| --- | --- |
| 当前没有 `codex_lark_*` 工具 | 刷新或重新启用插件，然后新开一个 Codex 对话。 |
| `status` 显示 `websocket disabled` | 检查 `~/.codex-lark-remote/config.json` 里的 `appId`、`appSecret` 和 `lark.domain`。 |
| 同一条飞书/Lark 消息收到两次回复 | 停止旧 bridge 进程或重复插件安装。 |
| Codex 改到了插件缓存目录 | 从目标项目所在的 Codex 对话里启动接管。 |
| 国际版用户鉴权失败 | 使用 `lark.domain: "lark"`，并使用 `https://open.larksuite.com` 的凭证。 |
