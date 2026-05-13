import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConsoleModeCard,
  buildBridgeStopConfirmCard,
  buildHandoffDisabledCard,
  buildStartupIntroCard,
  buildTakeoverConfirmCard,
  buildTakeoverListCard,
  buildTakeoverProjectListCard,
  buildTakeoverSelectedCard,
  formatBridgeStatus,
  formatBridgeStopCancelled,
  formatBridgeStopConfirm,
  formatBridgeStopping,
  formatConsoleModeIntro,
  formatFinal,
  formatGuidanceQueued,
  formatHelp,
  formatHandoffDisabled,
  formatObservationList,
  formatObservationStatus,
  formatPendingTakeoverInputQueued,
  formatProgress,
  formatStartupIntro,
  formatTask,
  formatTakeoverProjectList,
  formatTakeoverStatus,
  formatWhoami,
} from "../plugins/codex-lark-remote/src/presenter.mjs";

test("formatHelp includes whoami command", () => {
  assert.match(formatHelp(), /\bwhoami\b/);
  assert.match(formatHelp(), /\bobserve\b/);
  assert.match(formatHelp(), /commands on\|off/);
  assert.doesNotMatch(formatHelp(), /\/codex/);
});

test("formatStartupIntro explains conversational Feishu controls", () => {
  const text = formatStartupIntro();
  assert.match(text, /Codex 已经连上飞书/);
  assert.match(text, /外层是自然语言控制台/);
  assert.match(text, /看看有哪些项目/);
  assert.match(text, /接管第 2 个会话/);
  assert.match(text, /任务直通模式/);
  assert.match(text, /不再解析项目\/会话操作/);
  assert.match(text, /退出接管/);
  assert.match(text, /\bwindows\b/);
  assert.doesNotMatch(text, /\/codex/);
});

test("buildStartupIntroCard exposes clickable startup actions", () => {
  const card = buildStartupIntroCard();
  const rendered = JSON.stringify(card);
  assert.match(rendered, /Codex 已连接飞书/);
  assert.match(rendered, /外层是自然语言控制台/);
  assert.match(rendered, /任务直通模式/);
  assert.match(rendered, /按钮只是快捷入口/);
  assert.match(rendered, /状态/);
  assert.match(rendered, /进入控制台/);
  assert.match(rendered, /项目\/会话/);
  assert.match(rendered, /观察列表/);
  assert.match(rendered, /我的身份/);
  assert.match(rendered, /关闭连接/);
  assert.match(rendered, /真正断开飞书连接/);
  assert.match(rendered, /startup_status/);
  assert.match(rendered, /startup_console/);
  assert.match(rendered, /startup_windows/);
  assert.match(rendered, /bridge_stop_prompt/);
  assert.doesNotMatch(rendered, /\/codex/);
});

test("console mode intro is a natural-language control card", () => {
  const text = formatConsoleModeIntro();
  const rendered = JSON.stringify(buildConsoleModeCard());

  assert.match(text, /已进入外层自然语言控制台/);
  assert.match(text, /任务直通模式/);
  assert.match(text, /直接发送给目标 Codex 会话/);
  assert.match(rendered, /自然语言控制台/);
  assert.match(rendered, /直接发送给目标 Codex 会话/);
  assert.match(rendered, /关闭飞书连接/);
  assert.match(rendered, /startup_windows/);
  assert.match(rendered, /bridge_stop_prompt/);
  assert.doesNotMatch(rendered, /我的身份/);
  assert.doesNotMatch(rendered, /进入控制台/);
});

test("handoff disabled message distinguishes takeover exit from bridge disconnect", () => {
  const text = formatHandoffDisabled();
  const rendered = JSON.stringify(buildHandoffDisabledCard());

  assert.match(text, /已退出当前接管/);
  assert.match(text, /飞书连接仍然保持/);
  assert.match(rendered, /已退出当前接管/);
  assert.match(rendered, /不会再直通刚才的 Codex 会话/);
  assert.match(rendered, /startup_windows/);
});

test("bridge stop confirmation explains it closes the connection", () => {
  const text = formatBridgeStopConfirm();
  const rendered = JSON.stringify(buildBridgeStopConfirmCard());

  assert.match(text, /确认关闭飞书连接/);
  assert.match(text, /停止本机 Codex Lark Remote bridge/);
  assert.match(text, /重新启动插件/);
  assert.match(rendered, /确认关闭连接/);
  assert.match(rendered, /bridge_stop_execute/);
  assert.match(formatBridgeStopping(), /正在关闭飞书连接/);
  assert.match(formatBridgeStopCancelled(), /已取消关闭连接/);
});

test("formatWhoami returns the sender id needed for allowlist setup", () => {
  const text = formatWhoami({
    senderIdType: "user_id",
    senderId: "ou_user_123",
    openId: "ou_open_123",
    unionId: "on_union_123",
    userIdHash: "u_abc123",
  });

  assert.match(text, /senderIdType: user_id/);
  assert.match(text, /senderId: ou_user_123/);
  assert.match(text, /openId: ou_open_123/);
  assert.match(text, /unionId: on_union_123/);
  assert.match(text, /Add senderId to lark\.allowedUsers/);
});

test("formatBridgeStatus includes Mac keep-awake state", () => {
  const text = formatBridgeStatus({
    config: { lark: { transport: "websocket" }, handoff: { showCommands: false } },
    counts: {},
    workerBusy: false,
    url: "http://127.0.0.1:1234",
    larkWs: { enabled: true, connected: true },
    handoff: { active: true, threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2" },
    observation: { active: true, threadId: "019e0f92-2b48-7320-95b3-8ea1cc8189dd", name: "Migration" },
    keepAwake: { enabled: true, active: true, pid: 1234, platform: "darwin" },
  });

  assert.match(text, /Mac keep-awake: active pid=1234/);
  assert.match(text, /Observation: streaming 019e0f92 Migration/);
  assert.match(text, /Command display: off \(risky only\)/);
});

test("formatObservationList and status describe read-only session streaming", () => {
  const list = formatObservationList([
    {
      threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
      name: "Current migration",
      cwd: "/workspace",
      updatedAtMs: Date.UTC(2026, 4, 11, 5, 0, 0),
    },
  ]);
  const active = formatObservationStatus({
    active: true,
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    name: "Current migration",
    cwd: "/workspace",
  });

  assert.match(list, /可观察的 Codex 会话/);
  assert.match(list, /observe <序号或线程前缀>/);
  assert.match(active, /标题: Current migration/);
  assert.match(active, /只读进度串流/);
});

test("takeover cards use Chinese labels", () => {
  const target = {
    index: 1,
    status: "idle",
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    name: "当前会话",
    cwd: "/workspace",
    updatedAtMs: Date.UTC(2026, 4, 11, 5, 0, 0),
  };
  const rendered = JSON.stringify([
    buildTakeoverProjectListCard([{
      index: 1,
      name: "demo",
      cwd: "/workspace",
      windowCount: 2,
      latestWindowName: "当前会话",
      updatedAtMs: Date.UTC(2026, 4, 11, 5, 0, 0),
    }]),
    buildTakeoverListCard([target], { cwd: "/workspace" }),
    buildTakeoverSelectedCard(target),
    buildTakeoverConfirmCard(target),
  ]);
  const projectList = formatTakeoverProjectList([{
    index: 1,
    name: "demo",
    cwd: "/workspace",
    windowCount: 2,
    latestWindowName: "当前会话",
  }]);

  assert.match(projectList, /可接管项目/);
  assert.match(projectList, /allowedUsers/);
  assert.match(rendered, /当前项目的 Codex 会话/);
  assert.match(rendered, /当前项目/);
  assert.match(rendered, /不是 macOS 窗口枚举/);
  assert.match(rendered, /可接管项目/);
  assert.match(rendered, /进入项目/);
  assert.match(rendered, /观察/);
  assert.match(rendered, /接管/);
  assert.match(rendered, /确认接管/);
  assert.match(rendered, /取消/);
  assert.doesNotMatch(rendered, /查看|列表|View|Observe|Takeover|List|Confirm takeover|Cancel/);
});

test("takeover fallback text is explicit and localized", () => {
  const status = formatTakeoverStatus({
    state: "pending",
    target: {
      threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
      name: "目标会话",
      cwd: "/workspace",
      status: "running",
    },
    pendingInputs: [{ text: "继续" }],
  });
  const queued = formatPendingTakeoverInputQueued({ pendingInputs: [{ text: "继续" }] });

  assert.match(formatTakeoverStatus(null), /已关闭/);
  assert.match(status, /等待目标会话空闲/);
  assert.match(status, /线程: 019e0ffb/);
  assert.match(queued, /已暂存这条消息/);
  assert.match(queued, /待发送消息: 1/);
  assert.doesNotMatch(`${status}\n${queued}`, /Queued|Pending messages|Target thread/);
});

test("formatTask exposes the last notification delivery error", () => {
  const text = formatTask({
    id: "rcmd_test",
    status: "waiting_review",
    repoKey: "repo",
    lastNotifyError: "message not found",
    result: "done",
  });

  assert.match(text, /Last notify error:/);
  assert.match(text, /message not found/);
});

test("formatTask includes agent progress summaries", () => {
  const text = formatTask({
    id: "rcmd_test",
    status: "completed",
    repoKey: "repo",
    progressSummary: "Ran command: npm test",
  });

  assert.match(text, /Agent progress:/);
  assert.match(text, /Ran command: npm test/);
});

test("formatFinal returns only the Codex answer for chat handoff completions", () => {
  const text = formatFinal({
    id: "rcmd_chat",
    mode: "thread_handoff",
    presentation: "chat",
    status: "completed",
    codexSessionId: "019e0ffb",
    result: "这是 Codex 的直接回复。",
    diffSummary: "README.md | 1 +",
  });

  assert.equal(text, "这是 Codex 的直接回复。");
});

test("formatGuidanceQueued explains deferred guidance", () => {
  const text = formatGuidanceQueued({
    prompt: "优先修测试",
    normalizedTask: "优先修测试",
  });

  assert.match(text, /已收到补充引导/);
  assert.match(text, /当前轮结束后/);
  assert.match(text, /优先修测试/);
});

test("formatProgress returns only readable progress content", () => {
  const text = formatProgress({ id: "rcmd_test" }, "Ran command:\nnpm test\nOutput:\n51 passed");

  assert.doesNotMatch(text, /Codex progress/);
  assert.doesNotMatch(text, /Task: rcmd_test/);
  assert.match(text, /Ran command:\nnpm test/);
  assert.match(text, /Output:\n51 passed/);
});
