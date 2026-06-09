# Lark Remote Control Window Dispatch Implementation Plan

## 背景

Lark Remote 的目标不是让 JavaScript 直接把飞书消息写入目标 Codex
线程，也不是让启动连接的 Codex 窗口执行用户的代码任务。正确模式是：

1. 飞书消息进入本机 bridge。
2. bridge 只处理确定性的简单关键词和按钮动作。
3. 需要语义理解、目标选择、接管判断、歧义确认、线程派发的消息进入
   专用 Codex 控制窗口。
4. 控制窗口基于明确的 skill 和 MCP 能力做判断。
5. 当控制窗口判断应该派发到已接管目标时，控制窗口使用 Codex 宿主线程工具
   把提示词投递到目标 Codex 线程。

当前实现已经能把接管目标传到控制窗口，但没有把控制窗口使用方式设计成
一个清晰、可验证、低歧义的协议，导致控制窗口在应该派发时先调用了
旧的 context 快照工具，随后没有完成真实线程投递。

## 已确认的硬约束

1. 旧 MCP 名称直接删除，不保留 `lark_*` 兼容别名。
2. context 快照工具彻底删除，不改成 debug snapshot，也不在控制窗口路径中保留。
3. legacy worktree task 主路径关闭并清理代码；普通 Feishu/Lark 输入不再进入
   本地 worktree 任务。
4. 控制窗口能力锁定是启动必需步骤，但由程序和 skill 静默完成，不打扰用户。
5. active-target dispatch 不以 `codex exec resume` 成功作为投递成功信号。
6. 目标忙时仍按高优先级接管侧正常派发；只有宿主线程工具拒绝或不可用时才进入
   `blocked_retryable`。
7. Feishu/Lark 可见输出保持最小化，不泄露 routing contract、内部 id、session path、
   queue 细节或控制窗口思考过程。
8. 实施顺序按本文 Phase 1 到 Phase 5 推进。

## 当前失败链路

用户在飞书里接管 `检查并修复 codex-lark-remote 功能` 后，发送：

```text
全面的检查一下各个链路功能，优化代码逻辑，保证清晰的语义职责，检查修复 bug
```

当前代码执行路径：

1. `bridge-server.mjs` 收到飞书消息。
2. 简单关键词没有命中，消息被判定为普通任务。
3. `enqueueHandoffTask()` 创建 `thread_handoff` 队列任务。
4. 队列任务包含：
   - `codexSessionId`: 控制窗口线程 id。
   - `dispatchTarget`: 被接管目标线程 id、标题、cwd、状态。
   - `prompt`: 飞书用户文本。
5. `CodexCliRunner` claim 队列任务。
6. runner 通过 `buildHandoffPrompt()` 生成控制窗口提示词。
7. runner 执行：

```text
codex exec resume <controlThreadId> <controlPrompt>
```

8. 控制窗口收到 target 信息，但没有明确的执行协议。
9. 控制窗口先调用旧 context 快照工具，工具被取消。
10. 控制窗口没有真实完成 `send_message_to_thread`。
11. 飞书收到：

```text
投递未成功，已停止。
```

结论：失败点不是目标线程没有传递，而是控制窗口协议和能力面不清晰。

## 设计原则

### 1. 控制窗口不是机械执行器

控制窗口应该理解自然语言、处理模糊指代、选择项目/窗口、判断是否需要确认，
并在明确应该派发时执行线程派发。

### 2. 控制窗口也不是普通任务窗口

控制窗口不能执行飞书用户的代码任务。它不能在自己的 cwd 里检查仓库、改代码、
跑测试、提交代码。普通工作请求必须派发给目标线程，或者在目标不明确时向用户
确认。

### 3. bridge 只处理确定性简单关键词

以下不需要控制窗口理解，bridge 直接处理：

- `status`
- `控制台` / `console`
- `observe off`
- `commands on` / `commands off`
- `退出接管` / `exit handoff`
- `关闭飞书连接` / `close Lark connection`，需要确认
- 飞书交互卡片按钮

### 4. 控制窗口处理语义型控制和派发

以下应该交给控制窗口：

- “帮我看看有哪些项目”
- “进入刚才那个 codex-lark-remote 项目”
- “接管正在修 Lark Remote 的窗口”
- “观察最新任务”
- “把这条需求发给当前接管线程”
- 接管后的一般工作请求

### 5. MCP 和 skill 是控制窗口的操作系统

不能只在 prompt 里写一句 “use MCP tools if available”。skill 必须定义决策树；
MCP 必须提供控制窗口需要的明确能力；prompt 只提供本轮上下文和 remoteCommandId。

## 解耦职责分层

这次不能继续把能力堆在一条 prompt 里。控制窗口提示词、skill、MCP、Feishu/Lark
消息传输是四个主职责域；沿真实运行链路展开后，每层只做自己该做的事。

### Layer 0: Feishu/Lark 传输层

代码位置：

- `src/lark.mjs`
- `src/notifier.mjs`
- `src/presenter.mjs`

职责：

- 接收 Feishu/Lark 原始事件。
- 回复文本或卡片。
- 做消息分片、截断、脱敏、去重。
- 把 Codex/observer 的可见输出发送回 Feishu/Lark。

不负责：

- 不判断普通自然语言是不是代码任务。
- 不选择 Codex 目标线程。
- 不执行 host thread dispatch。
- 不把内部 routing contract、session path、sender hash、长篇规则发给飞书。

传输层只消费已经格式化好的用户可见消息，例如：

```text
已收到，控制窗口正在处理。
```

```text
已派发到：检查并修复 codex-lark-remote 功能
```

```text
暂时无法派发，消息已保留。
原因：宿主线程工具不可用。
```

### Layer 1: Bridge 入站路由层

代码位置：

- `src/bridge-server.mjs`
- `src/intent-router.mjs`
- `src/control-semantics.mjs`

职责：

- 验证权限和去重。
- 处理确定性简单关键词和卡片按钮。
- 维护 handoff/takeover/observation 的本地状态。
- 为非确定性自然语言创建一条 `thread_handoff` command。
- 把 `remoteCommandId`、Feishu 用户文本、当前 active target 摘要写入 queue。

不负责：

- 不用正则或翻译器完整理解普通工作请求。
- 不直接把普通消息写入目标 Codex 线程。
- 不把控制窗口的最终回答当作目标投递成功证据。

bridge 只做确定性前置拦截：

- `status`
- `控制台` / `console`
- `commands on/off`
- `observe off`
- `退出接管`
- `关闭飞书连接`
- 卡片按钮

其他文本进入控制窗口。

### Layer 2: Queue/Command 状态层

代码位置：

- `src/queue.mjs`

职责：

- 保存每条 Feishu/Lark 消息对应的 command。
- 保存 `remoteCommandId`、原文、active target 快照、message id、chat hash。
- 保存控制窗口处理状态。
- 保存 dispatch 结果：`sent` / `blocked` / `failed` / `waiting_clarification`。

不负责：

- 不做自然语言判断。
- 不调用 Codex host thread 工具。
- 不生成用户可见长文。

状态层必须成为“是否真的派发”的唯一记录点。runner exit code 只能说明控制窗口
turn 结束，不能说明目标线程收到了消息。

### Layer 3: 控制窗口 Prompt Envelope

代码位置：

- `src/runner.mjs`
- `buildControlWindowPrompt()`

职责：

- 给控制窗口一个短小、稳定的本轮入口。
- 只包含 `remoteCommandId`、Feishu/Lark 原文、可选 active target 摘要。
- 指向 skill：`Use the Lark Remote Control Window skill.`

不负责：

- 不承载完整 routing contract。
- 不承载权限边界长文。
- 不承载 sender hash、session file path、queue 细节。
- 不试图把所有规则都塞给模型。
- 不作为唯一事实来源。事实来源是 MCP 读取的 command。

推荐格式：

```text
[Lark Remote control message]
remoteCommandId: rcmd_xxx

activeTarget:
- title: 检查并修复 codex-lark-remote 功能
- threadId: 019ea7d4-...
- status: idle

feishuMessage:
全面的检查一下各个链路功能，优化代码逻辑，保证清晰的语义职责，检查修复 bug

Use the Lark Remote Control Window skill.
```

### Layer 4: Control Window Skill 策略层

代码位置：

- `skills/lark-remote-control-window/SKILL.md`

职责：

- 定义控制窗口的操作原则和决策树。
- 说明控制窗口不是目标任务执行者。
- 说明普通工作请求应该通过 host thread tool 投给 active target。
- 说明目标不明确或语义歧义时如何用 MCP 查询或请求确认。
- 说明派发完成后必须记录结果并立即结束。

不负责：

- 不保存动态状态。
- 不包含具体 remoteCommandId。
- 不假设 queue 内部结构。
- 不生成每条 Feishu 消息的详细可见文案。

skill 的核心决策树应该是：

```text
1. Read feishuMessage and decide whether it is a control action, target work request, or clarification case.
2. If it is a control action, use the specific Lark Remote MCP control tool.
3. After a non-dispatch control action, call lark_reply_remote_command.
4. If it is a target work request, call lark_prepare_dispatch.
5. If prepare_dispatch says action=dispatch, call the Codex host thread tool.
6. After host dispatch, call lark_record_dispatch.
7. If action=clarify, call lark_request_clarification.
8. If action=blocked, call lark_record_dispatch(status="blocked").
9. Do not run repository work in this control window.
10. End the turn after one action.
```

### Layer 5: Lark Remote MCP 能力层

代码位置：

- `bin/codex-lark-remote-mcp.mjs`
- `/bridge/*` endpoints in `src/bridge-server.mjs`

职责：

- 为控制窗口提供结构化能力。
- 读取 command、handoff、takeover、observation、queue 状态。
- 准备派发包。
- 记录派发结果。
- 记录非派发控制动作的 Feishu/Lark 可见回复。
- 请求 Feishu 用户确认。
- 提供项目/窗口选择、观察、接管、状态等操作。

不负责：

- 不直接调用 Codex host thread tool。
- 不伪造目标线程已收到消息。
- 不把普通任务当成本地 bridge 任务执行。

新增能力要围绕控制窗口的真实动作设计，而不是提供更大的模糊快照：

- `lark_prepare_dispatch`: 读取 `remoteCommandId` 对应 command，返回
  `action`、`target`、`targetPrompt`、`recordRequired`。
- `lark_record_dispatch`: 控制窗口完成 host thread dispatch 后回写
  `sent` / `blocked` / `failed`。
- `lark_request_clarification`: 目标或语义不明确时发确认卡片，并把 command
  置为 `waiting_clarification`。
- `lark_reply_remote_command`: 非派发控制动作完成后发送精简 Feishu/Lark
  回复，并把 command 置为 `control_completed`。

旧 context 快照工具不再作为 MCP 工具暴露，也不以 diagnostics-only 形式保留。
诊断必须拆到职责单一的 `get_*` / `list_*` 工具上，避免控制窗口回到“大快照优先”的
旧路径。

### Layer 6: Codex Host Thread 工具层

职责：

- 真正把 prompt 发送到目标 Codex 线程。
- 产生 host send/readback 证据。

典型工具：

- `send_message_to_thread`
- 后续如果 Codex 暴露更合适的 `handoff_thread` / interrupt / steer 工具，也在这一层。

不负责：

- 不理解 Feishu/Lark 语义。
- 不更新 Lark Remote queue。
- 不给 Feishu/Lark 直接发消息。

控制窗口调用顺序必须是：

```text
classify feishuMessage as target work request
lark_prepare_dispatch(remoteCommandId)
send_message_to_thread(threadId, targetPrompt)
lark_record_dispatch(remoteCommandId, status="sent", evidence=...)
```

如果 host thread 工具不可用，则不允许假装派发。控制窗口必须调用
`lark_record_dispatch(status="blocked")` 或
`lark_request_clarification()`，并结束这一轮。

### Layer 7: Observer/回传层

代码位置：

- `src/observer.mjs`
- `createSessionProgressWatcher()` in `src/runner.mjs`

职责：

- 观察目标线程 JSONL 增量。
- 把目标线程新的 assistant progress/final 发送到 Feishu/Lark。
- 对 Mac 本地输入或自动化输入补 `用户提示：` 分隔。
- 对 Lark Remote 自己派发的 `[Lark Remote dispatch]` prompt 不重复回显。

不负责：

- 不投递用户消息。
- 不判断是否需要接管。
- 不把控制窗口的思考过程当成目标执行进度。

观察层是“目标线程后续可见性”，不是“投递机制”。

## 层间接口

### Feishu/Lark 到控制窗口

```json
{
  "remoteCommandId": "rcmd_xxx",
  "message": "用户原文",
  "activeTargetHint": {
    "threadId": "019ea7d4-...",
    "title": "检查并修复 codex-lark-remote 功能",
    "status": "idle"
  }
}
```

这是 prompt envelope 的信息来源，但 prompt envelope 不是事实源。

### 控制窗口到 MCP

```json
{
  "tool": "lark_prepare_dispatch",
  "remoteCommandId": "rcmd_xxx"
}
```

MCP 返回结构化事实：

```json
{
  "ok": true,
  "action": "dispatch",
  "target": {
    "threadId": "019ea7d4-...",
    "title": "检查并修复 codex-lark-remote 功能",
    "cwd": "/Users/gaoxuefeng/Documents/CodexPlugin",
    "status": "idle"
  },
  "targetPrompt": "[Lark Remote dispatch]\n用户原文",
  "requiresRecord": true
}
```

### 控制窗口到目标线程

```json
{
  "tool": "send_message_to_thread",
  "threadId": "019ea7d4-...",
  "prompt": "[Lark Remote dispatch]\n用户原文"
}
```

### 控制窗口到 queue

```json
{
  "tool": "lark_record_dispatch",
  "remoteCommandId": "rcmd_xxx",
  "status": "sent",
  "targetThreadId": "019ea7d4-...",
  "hostTool": "send_message_to_thread",
  "readbackOk": true
}
```

### Queue/Presenter 到 Feishu/Lark

```text
已派发到：检查并修复 codex-lark-remote 功能
```

Feishu/Lark 传输层只发送这条结果，不泄漏控制窗口 prompt、MCP JSON 或 host
thread 内部细节。

## 目标链路

### A. 飞书消息进入 bridge

bridge 解析消息后执行确定性前置处理：

1. 如果是简单关键词，bridge 直接处理并回复飞书。
2. 如果是按钮动作，bridge 直接处理。
3. 其他消息进入控制窗口。

bridge 不对普通自然语言做完整语义分类。

### B. bridge 构造控制窗口 envelope

bridge 给控制窗口的 prompt 应该短小、稳定、低歧义：

```text
[Lark Remote control turn]
remoteCommandId: rcmd_xxx
source: feishu
message:
<feishu_lark_message>
用户原文
</feishu_lark_message>

activeTarget:
- threadId: 019ea7d4-...
- title: 检查并修复 codex-lark-remote 功能
- cwd: /Users/gaoxuefeng/Documents/CodexPlugin
- status: active|idle|running|unknown

Use the Lark Remote Control Window skill.
```

不再把大量规则、权限边界、sender hash、内部路径、长篇提示全部塞进每条消息。

### C. 控制窗口按 skill 决策

`skills/lark-remote-control-window/SKILL.md` 应定义以下决策树：

1. 读取 envelope。
2. 如果 envelope 有 `activeTarget.threadId`：
   - 如果消息是普通工作/代码/检查/修复/实现/分析请求，直接派发。
   - 如果消息看起来是控制请求，使用 MCP 或询问确认。
   - 如果无法判断是控制还是任务，向飞书用户确认。
3. 如果 envelope 没有 active target：
   - 使用 MCP 查询状态、列项目、列窗口、选择目标。
   - 不执行普通代码任务。
4. 派发路径中：
   - 不先调用旧 context 快照工具。
   - 不检查仓库。
   - 不运行 shell。
   - 不编辑文件。
   - 不回答目标任务本身。
   - 调用宿主线程工具完成派发。

### D. 控制窗口派发协议

当控制窗口判断应派发时，唯一允许的主动作是：

```js
send_message_to_thread({
  threadId: activeTarget.threadId,
  prompt: targetPrompt
})
```

`targetPrompt` 应包含来源标记，方便 observer 不重复回显飞书输入：

```text
[Lark Remote dispatch]
用户原文
```

派发成功后控制窗口回复：

```text
已派发到：检查并修复 codex-lark-remote 功能
```

派发失败后控制窗口不能说“已停止”然后丢弃。它必须使用 MCP 回写失败状态。

## MCP v2 能力设计

MCP 不能再提供“一个大而全的上下文快照，让控制窗口自己猜”。每个工具必须有单一
职责、单一输出语义、单一状态变化边界。控制窗口应该通过工具名就知道下一步动作，
而不是从一坨 JSON 里推理自己该做什么。

### 工具命名原则

- 对控制窗口暴露的 MCP 工具和 skill-facing 能力统一使用 `lark_` 前缀。
- `codex-lark-remote` 只作为插件包名、仓库名或文件路径保留。
- 不再使用旧的 Codex 前缀作为工具名前缀。
- `lock_*`: 只在控制窗口绑定/锁定时使用，写入长期本地能力状态。
- `get_*`: 只读取一个明确对象，不改变状态。
- `list_*`: 只列候选项，不选择。
- `select_*`: 只选择候选项，不确认接管。
- `confirm_*`: 只执行确认过的高影响状态切换。
- `prepare_*`: 只准备下一步动作包，不执行外部动作。
- `record_*`: 只记录外部动作结果，不执行外部动作。
- `request_*`: 只向 Feishu/Lark 用户发确认或澄清请求。
- `clear_*`: 只清理指定状态。

### 删除或退役的宽泛工具

#### 旧 context 快照工具

问题：

- 名字和输出都太宽泛。
- 被 skill 写成 first-stop 后，会诱导控制窗口在 active target 明确时也先查
  context。
- 一旦 context 工具失败或返回不完整，控制窗口会忽略 prompt 里已有的 target。
- 它把 bridge、handoff、takeover、observation、queue、projects、targets 混在一个
  响应里，职责不可测试。

处理：

- 从控制窗口 skill 删除。
- 从普通 MCP 工具列表彻底删除。
- 不保留 renamed/debug 版本。

替代：

- `lark_get_bridge_status`
- `lark_get_control_window`
- `lark_get_active_target`
- `lark_list_projects`
- `lark_list_project_sessions`
- `lark_get_remote_command`
- `lark_prepare_dispatch`

#### 旧 manual send 工具

问题：

- 这是旧的 worktree task 模式入口，会把飞书请求变成本地隔离任务。
- 新模式里普通 Feishu/Lark 文本应该进入控制窗口，再由控制窗口派发到目标线程。
- 这个工具名也过于笼统，看不出是发给 bridge queue、目标线程、还是 Feishu。

处理：

- 从控制窗口 skill 删除。
- 从公开 MCP 工具删除。
- legacy worktree task 主路径关闭，普通 Feishu/Lark 输入不再通过这个模式执行。

#### 旧 task/history 工具

问题：

- 当前是泛 queue 检查工具，混合旧 worktree task 和新 handoff command。

处理：

- 拆成专职工具：
  - `lark_get_remote_command`
  - `lark_list_remote_commands`
  - `lark_get_dispatch_status`

#### 旧 cancel/approve 工具

问题：

- 名字没有说明取消/批准的是 remote command、legacy task、还是目标线程任务。
- `approve` 属于旧 worktree review/commit/push 流程，和控制窗口派发模型无关。

处理：

- cancel 改名为 `lark_cancel_remote_command`。
- approve 删除；旧 worktree review/approve 流程不再属于 Lark Remote
  接管主链路。

### 控制窗口锁定工具

#### `lark_lock_control_window`

用途：在启动连接/准备接管时，一次性锁定当前 Codex 窗口为控制窗口，并保存它确认过
的宿主线程能力。后续每次 Feishu 消息不再重新判断工具是否存在，只读取这个本地能力
快照。

输入：

```json
{
  "confirmedLocalBridgeHandoff": true,
  "capabilities": {
    "hostThreadSend": {
      "available": true,
      "tool": "send_message_to_thread"
    },
    "hostThreadRead": {
      "available": true,
      "tool": "read_thread"
    },
    "hostThreadInterrupt": {
      "available": false,
      "tool": ""
    }
  }
}
```

行为：

- 使用 Codex MCP request metadata 绑定当前 thread id、session path、cwd。
- 写入 `control-window.json` 或扩展现有 `handoff.json`：

```json
{
  "active": true,
  "threadId": "019e...",
  "threadPath": "...jsonl",
  "cwd": "/Users/gaoxuefeng/Documents/CodexPlugin",
  "name": "开启飞书远程连接",
  "capabilities": {
    "hostThreadSend": {
      "available": true,
      "tool": "send_message_to_thread",
      "confirmedAt": "2026-06-09T..."
    },
    "hostThreadRead": {
      "available": true,
      "tool": "read_thread",
      "confirmedAt": "2026-06-09T..."
    },
    "hostThreadInterrupt": {
      "available": false,
      "tool": "",
      "confirmedAt": "2026-06-09T..."
    }
  },
  "pluginVersion": "0.x.y",
  "lockedAt": "2026-06-09T...",
  "lockedBy": "mcp"
}
```

规则：

- 控制窗口能力在 lock 时确认并保存。
- `prepare_dispatch` 只读保存的能力，不每次询问模型“你有没有工具”。
- 如果保存能力显示 `hostThreadSend.available=false`，active target 下普通任务进入
  `blocked_retryable`，并提示用户需要重新从具备 host thread 工具的 Codex 窗口启动。
- 如果 lock 的 thread id 和后续 queue 的 control thread id 不一致，fail closed。
- 如果 pluginVersion 大版本不兼容，要求重新 lock。

现有 `lark_lock_control_window` 和 `lark_prepare_takeover` 应该收敛到这个锁定流程：

- `lark_lock_control_window`: 锁定控制窗口，不再单独定义一套 handoff 语义。
- `lark_prepare_takeover`: setup convenience，先 lock control window，再初始化
  target selection scope。

### 状态读取工具

#### `lark_get_bridge_status`

职责：只返回 bridge/WebSocket/keep-awake/worker 运行状态。

不返回：

- projects
- sessions
- queue
- active target prompt

#### `lark_get_control_window`

职责：返回当前锁定控制窗口和保存的能力快照。

用于：

- 用户问“控制窗口是谁”
- 诊断 capability mismatch
- `prepare_dispatch` 内部校验

#### `lark_get_active_target`

职责：只返回当前 active/pending takeover target。

输出：

```json
{
  "state": "active",
  "target": {
    "threadId": "019ea7d4-...",
    "title": "检查并修复 codex-lark-remote 功能",
    "cwd": "/Users/gaoxuefeng/Documents/CodexPlugin",
    "status": "idle"
  }
}
```

不返回 queue 或项目列表。

#### `lark_get_remote_command`

职责：按 `remoteCommandId` 读取一条 Feishu/Lark command。

用于：

- 控制窗口需要确认本轮原文、message id、target 快照。
- 调试指定 command。

### 项目/窗口选择工具

#### `lark_list_projects`

替代旧项目列表工具。

职责：只列项目，不选择。

#### `lark_select_project`

替代旧项目选择工具。

职责：只选择项目并返回该项目会话候选。

#### `lark_list_project_sessions`

替代旧会话列表工具。

职责：只列当前或指定项目的 Codex sessions。

#### `lark_select_target`

替代旧 takeover 组合工具的选择分支。

职责：只选择/预览目标，生成确认卡片或选择状态。

#### `lark_confirm_takeover`

替代旧 takeover 组合工具的确认分支。

职责：执行接管确认，写入 active target，并启动目标临时观察。

高影响状态切换必须通过 `confirm_*`，不能把 select 和 execute 混在一个工具里。

### 观察工具

#### `lark_list_observable_sessions`

替代 `lark_observation_targets`。

职责：只列可观察 session。

#### `lark_start_observation`

替代 `lark_observe`。

职责：启动只读观察。

#### `lark_stop_observation`

替代 `lark_observe_stop`。

职责：停止只读观察。

### 派发工具

#### `lark_prepare_dispatch`

用途：控制窗口已经判断当前 Feishu/Lark 消息是目标工作请求后，读取
`remoteCommandId` 对应的 command、target、用户文本、控制窗口能力快照，并返回
目标派发准备结果。

输入：

```json
{
  "remoteCommandId": "rcmd_xxx"
}
```

输出：

```json
{
  "ok": true,
  "action": "dispatch" | "clarify" | "blocked",
  "target": {
    "threadId": "019ea7d4-...",
    "title": "检查并修复 codex-lark-remote 功能",
    "cwd": "/Users/gaoxuefeng/Documents/CodexPlugin",
    "status": "active"
  },
  "targetPrompt": "[Lark Remote dispatch]\n用户原文",
  "controlWindow": {
    "threadId": "019e...",
    "hostThreadSend": true,
    "hostThreadRead": true,
    "hostThreadInterrupt": false
  },
  "recordRequired": true
}
```

规则：

- 这个工具不是替代宿主线程派发，只准备派发包。
- 如果 active target 明确且 hostThreadSend 已在 lock 时确认，返回 `action=dispatch`。
- 如果没有 active target，返回 `action=clarify`。
- 如果 hostThreadSend 未在 lock 时确认，返回 `action=blocked`。
- 控制请求不应该调用这个工具；控制窗口应先使用职责专一的 control MCP 工具。
- 不返回项目列表和全局上下文。

#### `lark_record_dispatch`

用途：控制窗口执行宿主线程派发后，回写结果。

输入：

```json
{
  "remoteCommandId": "rcmd_xxx",
  "status": "sent" | "blocked" | "failed",
  "targetThreadId": "019ea7d4-...",
  "hostTool": "send_message_to_thread",
  "readbackOk": true,
  "evidence": "host accepted follow-up prompt",
  "error": ""
}
```

行为：

- `sent`: 队列任务完成，飞书回复简洁成功。
- `blocked`: 队列任务保留为 blocked/retryable，不丢失用户输入。
- `failed`: 非重试失败，记录错误。

约束：

- runner 不能直接把 command 从 `running` 改成 `completed`。
- 只有 `record_dispatch(status="sent")` 能把 active-target dispatch 标记为完成。
- `blocked` 必须保留 `targetPrompt` 和目标信息，允许后续 retry。

#### `lark_request_clarification`

用途：控制窗口语义不确定时向飞书用户确认。

输入：

```json
{
  "remoteCommandId": "rcmd_xxx",
  "question": "这条消息是要发给当前接管线程，还是要打开控制台？",
  "choices": ["发给当前线程", "打开控制台"]
}
```

行为：

- 飞书收到确认卡片。
- 原命令进入 `waiting_clarification`。
- 用户选择后恢复控制窗口流程。

#### `lark_reply_remote_command`

用途：控制窗口完成非派发控制动作后，发送一条 Feishu/Lark 可见回复，并把命令
标记为 `control_completed`。

输入：

```json
{
  "remoteCommandId": "rcmd_xxx",
  "text": "当前可接管项目：CodexPlugin",
  "status": "completed"
}
```

行为：

- 只负责回复和记录完成，不做语义判断。
- 不派发到目标线程。
- 不读取或返回全局快照。
- runner 看到 `control_completed` 后不会再把 Codex final 或 token 统计发到飞书。

### 远程命令工具

#### `lark_cancel_remote_command`

职责：取消指定 remote command。

不取消：

- 已经投递到目标线程并开始执行的目标 Codex turn。
- legacy worktree task，除非显式 legacy 工具。

#### `lark_list_remote_commands`

职责：只列 Lark Remote command queue，按状态过滤。

输入：

```json
{
  "status": "pending|running|blocked_retryable|waiting_clarification|dispatch_sent|failed",
  "limit": 20
}
```

### Legacy worktree task 清理

旧 worktree task 功能不再作为 Lark Remote 主路径或公开 MCP 能力存在。保留在源码中的
历史实现必须被断开入口并逐步删除；不能再给控制窗口、Feishu/Lark 普通消息或 README
暴露为可选路径。

## 状态与队列

### 队列任务状态

需要区分：

- `pending`: 等待控制窗口处理。
- `running`: 控制窗口正在处理。
- `dispatch_sent`: 宿主线程工具已接受。
- `waiting_clarification`: 等待用户确认。
- `blocked_retryable`: 暂时无法派发，但消息保留。
- `failed`: 不可恢复失败。
- `cancelled`: 用户取消。

### 不允许的状态转换

- 已有 target 的普通任务不能从 `running` 直接变成 `completed`，除非
  `lark_record_dispatch(status="sent")` 已执行。
- 宿主线程工具不可用时不能丢弃消息。
- 目标忙时不能直接 fail；必须进入 `blocked_retryable` 或使用宿主支持的
  steer/interrupt 能力。

## 控制窗口执行面

当前 runner 使用：

```text
codex exec resume <controlThreadId> <prompt>
```

这个执行面可能不是用户正在看的 Codex Desktop 控制窗口，也不一定拥有
`send_message_to_thread` 这类宿主线程工具。新设计不应该在每次 Feishu 消息到来时
反复让控制窗口判断“我有没有工具”，而是在控制窗口锁定时确认一次并本地保存。

### 控制窗口锁定时确认能力

锁定流程：

1. 用户在 Codex 窗口启动 Lark Remote。
2. skill 检查当前窗口是否能看到 Codex host thread tools。
3. 当前窗口调用 `lark_lock_control_window`，传入能力声明。
4. MCP 使用 request metadata 写入控制窗口 thread id、session path、cwd。
5. bridge 保存能力快照。
6. Feishu 后续普通消息只引用这个已锁定控制窗口。

能力状态示例：

```json
{
  "controlWindow": {
    "threadId": "019e...",
    "threadPath": "...jsonl",
    "cwd": "/Users/gaoxuefeng/Documents/CodexPlugin",
    "capabilities": {
      "hostThreadSend": {
        "available": true,
        "tool": "send_message_to_thread"
      },
      "hostThreadRead": {
        "available": true,
        "tool": "read_thread"
      },
      "hostThreadInterrupt": {
        "available": false,
        "tool": ""
      }
    }
  }
}
```

### 运行时使用能力快照

`lark_prepare_dispatch(remoteCommandId)` 读取保存的能力快照：

- `hostThreadSend=true`: 可以返回 `action=dispatch`。
- `hostThreadSend=false`: 返回 `action=blocked`，原因是控制窗口不具备宿主线程发送
  能力。
- `hostThreadRead=true`: 派发后控制窗口可以读目标线程做 readback。
- `hostThreadInterrupt=true`: 目标忙时可以用高优先级 interrupt/steer 路径。
- `hostThreadInterrupt=false`: 目标忙时仍按普通 dispatch 尝试发送；如果 host tool
  拒绝，再记录 `blocked_retryable`。

这避免每次都把工具能力判断塞进 prompt，也避免控制窗口在一次失败后误判为目标缺失。

### 执行面选择

1. 首选：Codex Desktop 当前控制窗口自然执行，由它直接调用 host thread tools。
2. 可选：如果 Codex App/Desktop 提供稳定 app-server turn API，则 bridge 可以通过
   该 API 唤起控制窗口 turn。
3. 降级：`codex exec resume` 只能用来唤起已锁定控制窗口处理本轮 remote command；
   active-target dispatch 是否成功必须由 `lark_record_dispatch` 写回，不由 resume
   exit code 判定。
4. 如果执行面没有宿主线程工具，控制窗口必须通过 MCP 标记 `blocked_retryable`，
   不能假装派发。

### runner 的职责变化

旧 runner 职责：

- claim `thread_handoff` command。
- `codex exec resume` 控制窗口。
- 把控制窗口 final 当作最终 Feishu 回复。
- exit code 0 就把 command 标记 completed。

新 runner 职责：

- claim `thread_handoff` command。
- 只负责把短 envelope 交给控制窗口。
- 不再判定目标 dispatch 成功。
- 对 active-target dispatch command，等待 `lark_record_dispatch` 修改状态。
- 如果控制窗口 turn 正常结束但没有 record，标记 `blocked_retryable`，而不是
  `completed`。
- 只把用户可见、已经格式化的状态发送到 Feishu，不转发控制窗口内部思考链。

## Prompt Contract

### 普通控制窗口消息

```text
[Lark Remote control turn]
remoteCommandId: rcmd_xxx
message:
<feishu_lark_message>
...
</feishu_lark_message>

Use lark-remote-control-window skill.
```

### 已有 target 的派发候选消息

```text
[Lark Remote control turn]
remoteCommandId: rcmd_xxx
activeTarget:
- threadId: 019ea7d4-...
- title: 检查并修复 codex-lark-remote 功能

message:
<feishu_lark_message>
全面的检查一下各个链路功能...
</feishu_lark_message>

Use lark-remote-control-window skill.
```

### 控制窗口派发动作要求

skill 中必须明确：

```text
When dispatching:
1. Build targetPrompt exactly from the Feishu/Lark message.
2. Call send_message_to_thread with target.threadId and targetPrompt.
3. Call lark_record_dispatch with sent or blocked/failed.
4. Reply briefly and end the turn.
```

## 飞书可见输出

### 收到消息

```text
已收到，控制窗口正在处理。
```

不要说“正在准备线程派发”，除非控制窗口已经确认是派发。

### 派发成功

```text
已派发到：检查并修复 codex-lark-remote 功能
```

### 需要确认

```text
这条消息是要发给当前接管线程，还是要打开控制台？
```

### 阻塞但保留

```text
暂时无法派发到目标线程，消息已保留。
原因：宿主线程工具不可用 / 目标线程当前不能接收。
```

## 旧设计清理与统一重构

### 1. 退役 JS 语义翻译器作为主路径

当前代码：

- `src/intent-router.mjs`
- `src/intent-translator.mjs`
- 默认配置 `intent.translator.provider = "codex-thread"`

问题：

- bridge 会启动另一个 Codex 进程做语义翻译。
- 这和“控制窗口负责语义理解”冲突。
- 它会让同一条 Feishu 消息在 JS 层和控制窗口层被理解两次。
- 一旦 translator 输出和控制窗口判断不一致，职责就混乱。

新规则：

- bridge 只处理确定性简单关键词和按钮。
- 语义型控制请求进入控制窗口。
- `intent-translator` 默认关闭。
- 如果保留，只作为 legacy console fallback，必须配置显式开启，例如
  `intent.translator.enabledForConsoleFallback=true`。
- active handoff/takeover 下不调用 translator。

重构点：

- `routeChatTextAction()` 在 `handoff.active` 或 control window locked 时，除了简单关键词，
  全部进入 `thread_handoff` command。
- `routeConsoleText()` 只做规则匹配和卡片按钮，不再默认调用 `translateTextToIntent()`。

### 2. 退役 legacy worktree task 主路径

当前代码：

- `enqueueTask()`
- `CodexCliRunner.#prepareWorktree()`
- `buildRunnerPrompt()`
- 旧 manual send 工具
- 旧 approve 工具
- `src/actions.mjs`

问题：

- 旧模式把 Feishu 消息变成本地 worktree 任务。
- 新 Lark Remote 的产品心智是“控制窗口 + 目标 Codex 线程派发”。
- worktree 模式会让用户误以为接管的是某个 Codex 窗口，实际却创建了一个隐形本地任务。

新规则：

- Feishu/Lark 普通消息永远不走 legacy worktree task。
- legacy worktree 功能如果需要保留，必须：
  - 默认关闭。
  - 工具名加 `legacy`。
  - README 中移到 advanced/deprecated。
  - 控制窗口 skill 不提及。

建议配置：

```json
{
  "legacy": {
    "worktreeTasks": false
  }
}
```

### 3. 拆分旧 takeover 组合工具

旧 takeover 组合工具同时做选择和执行：

```json
{
  "selector": "1",
  "execute": true
}
```

问题：

- 一个工具同时承担 preview/select/execute。
- 控制窗口不容易判断这是不是高影响动作。
- 测试也难覆盖“只是选择”和“确认接管”的边界。

新工具：

- `lark_select_target`
- `lark_confirm_takeover`
- `lark_clear_active_target`

### 4. 拆分 `handoff` 概念

旧设计里 `handoff` 同时表示：

- 启动连接的控制窗口已 attach。
- Feishu 消息继续某个 Codex 线程。
- 目标线程接管/派发。
- 退出接管或关闭 bridge。

新设计拆成三个状态对象：

```json
{
  "controlWindow": {
    "active": true,
    "threadId": "019e...",
    "capabilities": {}
  },
  "activeTarget": {
    "state": "none|selected|pending|active",
    "threadId": "019e..."
  },
  "bridge": {
    "running": true,
    "larkWebsocket": "connected"
  }
}
```

命名规则：

- `controlWindow`: 启动连接的 Codex 窗口。
- `activeTarget`: 被接管/准备接管的目标 Codex 线程。
- `bridge`: 本地 Feishu/Lark 连接进程。
- `dispatch`: 一条 Feishu 消息到目标线程的单次投递。

这样 “退出接管” 只清 activeTarget，不清 controlWindow 和 bridge；“关闭飞书连接” 才停
bridge。

### 5. 删除 prompt-heavy routing contract

旧设计把大量规则放进每次发给控制窗口的 prompt，包括：

- routing contract
- permission boundary
- sender hash
- target session
- long control instructions

问题：

- prompt 太长，控制窗口容易把 meta 当用户任务内容。
- Feishu 观察会显示大段控制文本。
- 同一规则分散在 README、skill、prompt、MCP 描述里，容易互相打架。

新规则：

- prompt 只传 `remoteCommandId`、原文、active target hint。
- 决策规则只在 skill。
- 动态事实只在 MCP。
- 用户可见文案只在 presenter。

### 6. 删除 final-answer-as-success

旧设计：

- `CodexCliRunner.#runHandoffOne()` 用 `codex exec resume` exit code 判定 command 成功。
- `formatFinal()` 把控制窗口 final 直接发给 Feishu。

问题：

- 控制窗口说“我会派发”不等于目标线程已收到。
- 控制窗口失败 final 也可能被当作一条普通聊天结果。
- 缺少结构化 `sent/blocked/failed` 记录。

新规则：

- active-target dispatch 只看 `lark_record_dispatch`。
- runner exit code 只代表控制窗口 turn 状态。
- 没有 record 的 command 进入 `blocked_retryable`。
- Feishu 成功消息由 `record_dispatch(sent)` 触发。

### 7. 清理 skill 暴露面

`skills/lark-remote-control-window/SKILL.md` 必须改成只提专职工具：

- `lark_prepare_dispatch`
- `lark_record_dispatch`
- `lark_request_clarification`
- `lark_get_bridge_status`
- `lark_get_control_window`
- `lark_get_active_target`
- `lark_list_projects`
- `lark_select_project`
- `lark_list_project_sessions`
- `lark_select_target`
- `lark_confirm_takeover`
- `lark_start_observation`
- `lark_stop_observation`

必须删除：

- 旧 context 快照工具
- 旧 manual send 工具
- worktree / approve / repo task 相关说明
- “Use available tools before guessing from prose” 这种模糊提示

### 8. README 和测试同步

README 应表达新产品模型：

- 飞书连接启动窗口就是 control window。
- control window 锁定时确认 host thread 能力。
- Feishu 简单关键词 direct bridge。
- Feishu 普通/语义消息进入 control window。
- control window 使用专职 MCP + host thread tool 派发。
- legacy worktree task 是 deprecated advanced mode。

测试需要从“prompt 文本有没有某句话”升级为“状态和工具职责是否闭环”：

- lock control window stores capabilities。
- active target 普通消息进入 command。
- `prepare_dispatch` 返回 action=dispatch。
- runner 不把 exit 0 作为 dispatch success。
- `record_dispatch(sent)` 才触发成功通知。
- context/debug snapshot 不在 control-window skill 中出现。

## 测试计划

### Unit tests

1. bridge 简单关键词直接处理，不进入控制窗口队列。
2. active target + 普通工作请求生成控制窗口 envelope。
3. envelope 不包含长篇 routing contract。
4. envelope 包含 `remoteCommandId` 和 active target 摘要。
5. `lark_lock_control_window` 保存 control thread id 和 host thread 能力。
6. `lark_prepare_dispatch` 根据 remoteCommandId 返回稳定 targetPrompt。
7. `lark_prepare_dispatch` 读取锁定能力；能力缺失时返回 blocked，不再次问模型。
8. `lark_record_dispatch(status="sent")` 完成队列任务并触发 Feishu 成功通知。
9. `lark_record_dispatch(status="blocked")` 保留队列任务。
10. `lark_request_clarification` 进入 `waiting_clarification`。
11. runner exit 0 但无 `record_dispatch` 时，command 进入 `blocked_retryable`。
12. debug snapshot 不在控制窗口 skill 或普通工具列表中出现。

### Skill contract tests

1. control-window skill 明确：
   - 有 active target 且是普通任务时，先派发。
   - 派发前先调用 `lark_prepare_dispatch`，不调用旧 context/debug snapshot。
   - 不在控制窗口执行仓库工作。
   - host thread 能力来自锁定快照，不在每轮重新判断。
2. plugin layout 测试确认 skill 暴露了：
   - `send_message_to_thread`
   - `lark_lock_control_window`
   - `lark_prepare_dispatch`
   - `lark_record_dispatch`
   - `lark_request_clarification`
   - `lark_reply_remote_command`
   - 专职 project/session/target/observation 工具
3. plugin layout 测试确认 skill 不暴露：
   - 旧 context 快照工具
   - 旧 manual send 工具
   - 旧 approve 工具
   - legacy worktree 工具

### Integration tests

1. 新 Codex 窗口启动 Lark Remote。
2. `lark_lock_control_window` 保存 host thread 能力。
3. Feishu 选择并确认接管目标 A。
4. 飞书发普通工作请求。
5. 控制窗口收到短 envelope。
6. 控制窗口调用 `lark_prepare_dispatch`。
7. 控制窗口调用宿主线程工具派发到 A。
8. 控制窗口调用 `lark_record_dispatch(sent)`。
9. 队列记录 `dispatch_sent`。
10. 飞书收到派发成功。
11. A 的观察流显示目标线程收到新用户提示。

### Regression tests for current bug

测试名称建议：

```text
control window dispatch does not call context when target is explicit
```

场景：

- command 有 `dispatchTarget.threadId`。
- prompt 是普通工作请求。
- 期望 skill/prompt contract 要求先 `prepare_dispatch`，再 host-thread send。
- 不出现“先调用旧 context 快照工具”的指令。

## 分阶段实施

### Phase 1: 固化控制窗口锁定和 prompt 协议

- 新增/改造 `lark_lock_control_window`。
- 保存 control thread id、thread path、cwd、host thread 能力。
- 修改 `skills/lark-remote-control-window/SKILL.md`。
- 修改 `buildControlWindowPrompt()`，缩短 prompt 并明确决策树入口。
- `lark_lock_control_window` / `lark_prepare_takeover` 收敛到 lock 流程。
- 补 prompt/skill contract 测试。

### Phase 2: 拆分 MCP v2

- 彻底删除旧 context 快照工具，不保留 debug snapshot。
- 删除控制窗口可见的旧 manual send / approve 工具。
- 拆分旧 takeover 组合工具为 select/confirm/clear。
- 拆分 observation 和 project/session 工具。
- 新增 `lark_prepare_dispatch`。
- 新增 `lark_record_dispatch`。
- 新增 `lark_request_clarification`。
- 队列增加 `waiting_clarification`、`blocked_retryable`、`dispatch_sent`。

### Phase 3: 修正 runner 和状态闭环

- runner 不再用控制窗口 final/exit code 判定目标 dispatch 成功。
- active-target dispatch 必须等待 `record_dispatch`。
- 无 record 的控制窗口 turn 进入 `blocked_retryable`。
- Feishu 可见消息由 presenter 根据 command 状态生成，不直接转发内部控制过程。

### Phase 4: 清理旧路径

- active handoff/takeover 下禁用 `intent-translator`。
- legacy worktree task 主路径关闭，公开 MCP 和文档入口删除。
- README 删除旧 “context first-stop” 和 worktree 主路径描述。
- 测试更新为 MCP v2 和 lock 能力模型。

### Phase 5: 端到端验证

- 新开窗口加载最新插件。
- 启动飞书连接。
- 确认 control window capability lock 已保存。
- 选择并确认接管目标线程。
- 飞书发送普通工作请求。
- 验证目标线程收到 `[Lark Remote dispatch]`。
- 验证飞书只收到简洁状态和目标观察进度。

## Done Definition

这个功能完成必须同时满足：

1. 简单关键词由 bridge 直接处理。
2. 语义型控制由控制窗口 + MCP/skill 处理。
3. active target 下普通任务由控制窗口派发到目标线程。
4. 控制窗口不会在自己的 cwd 执行目标任务。
5. 控制窗口能力在 lock 时确认并本地保存。
6. 每轮 dispatch 读取能力快照，不重新靠 prompt 判断工具能力。
7. 已有明确 target 时不会调用旧 context 快照或 debug snapshot。
8. 派发成功只由 `record_dispatch(sent)` 判定。
9. 派发失败不丢消息。
10. legacy worktree task 不在新接管主路径中出现。
11. 飞书能看到目标线程后续进度。
12. 测试覆盖当前失败链路。
