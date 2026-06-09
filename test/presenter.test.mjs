import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConsoleModeCard,
  buildBridgeStopConfirmCard,
  buildBridgeStatusCard,
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
  formatHandoffModeUnavailable,
  formatHandoffSessionBusy,
  formatObservationList,
  formatObservationStatus,
  formatPendingTakeoverInputDiscarded,
  formatProgress,
  formatStartupIntro,
  formatTask,
  formatTakeoverActive,
  formatTakeoverPreparationCancelled,
  formatTakeoverList,
  formatTakeoverProjectList,
  formatTakeoverStatus,
  formatTakeoverTimedOut,
  formatWhoami,
} from "../src/presenter.mjs";

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
  assert.match(text, /线程派发模式/);
  assert.match(text, /不再解析项目\/会话操作/);
  assert.match(text, /退出接管/);
  assert.doesNotMatch(text, /project list|enter project|takeover 2|exit handoff|\bwindows\b/);
  assert.doesNotMatch(text, /\/codex/);
});

test("formatStartupIntro can render English without Chinese command text", () => {
  const text = formatStartupIntro({ language: "en" });
  assert.match(text, /Codex is connected to Lark/);
  assert.match(text, /project list/);
  assert.match(text, /enter project 1/);
  assert.match(text, /takeover 2/);
  assert.match(text, /exit handoff/);
  assert.doesNotMatch(text, /[\u3400-\u9fff]/);
});

test("buildStartupIntroCard exposes clickable startup actions", () => {
  const card = buildStartupIntroCard();
  const rendered = JSON.stringify(card);
  assert.match(rendered, /Codex 已连接飞书/);
  assert.match(rendered, /外层是自然语言控制台/);
  assert.match(rendered, /线程派发模式/);
  assert.doesNotMatch(rendered, /project list|close Lark connection|exit handoff/);
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

test("buildStartupIntroCard renders English actions when requested", () => {
  const rendered = JSON.stringify(buildStartupIntroCard({ language: "en" }));
  assert.match(rendered, /Codex Connected To Lark/);
  assert.match(rendered, /project list/);
  assert.match(rendered, /Close Connection/);
  assert.match(rendered, /startup_console/);
  assert.doesNotMatch(rendered, /[\u3400-\u9fff]/);
});

test("console mode intro is a natural-language control card", () => {
  const text = formatConsoleModeIntro();
  const rendered = JSON.stringify(buildConsoleModeCard());

  assert.match(text, /已进入外层自然语言控制台/);
  assert.match(text, /线程派发模式/);
  assert.match(text, /专用 Codex 控制窗口/);
  assert.match(text, /进入项目 1/);
  assert.match(rendered, /自然语言控制台/);
  assert.match(rendered, /专用 Codex 控制窗口/);
  assert.match(rendered, /接管 1/);
  assert.match(rendered, /关闭飞书连接/);
  assert.match(rendered, /startup_windows/);
  assert.match(rendered, /bridge_stop_prompt/);
  assert.doesNotMatch(rendered, /我的身份/);
  assert.doesNotMatch(rendered, /进入控制台/);
  assert.doesNotMatch(rendered, /enter project|takeover 1|close Lark connection/);
});

test("console mode card can render English only", () => {
  const text = formatConsoleModeIntro({ language: "en" });
  const rendered = JSON.stringify(buildConsoleModeCard({ language: "en" }));

  assert.match(text, /Entered the natural-language console/);
  assert.match(text, /enter project 1/);
  assert.match(rendered, /Natural-Language Console/);
  assert.match(rendered, /Close Connection/);
  assert.doesNotMatch(rendered, /[\u3400-\u9fff]/);
});

test("handoff disabled message distinguishes takeover exit from bridge disconnect", () => {
  const text = formatHandoffDisabled();
  const rendered = JSON.stringify(buildHandoffDisabledCard());

  assert.match(text, /已退出当前接管/);
  assert.match(text, /飞书连接仍然保持/);
  assert.match(rendered, /已退出当前接管/);
  assert.match(rendered, /不会再派发到刚才的 Codex 会话/);
  assert.match(rendered, /项目列表/);
  assert.match(rendered, /接管 2/);
  assert.match(rendered, /startup_windows/);
  assert.doesNotMatch(rendered, /project list|takeover 2|jump out of handoff/);
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
  assert.match(text, /add one of these IDs to lark\.allowedUsers/);
  assert.match(text, /allowedUsers: \["ou_user_123"\]/);
  assert.match(text, /粘回 Codex/);
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

test("buildBridgeStatusCard explains mode and next message route", () => {
  const card = buildBridgeStatusCard({
    config: { lark: { transport: "websocket" } },
    counts: { pending: 1 },
    workerBusy: true,
    larkWs: { enabled: true, connected: true },
    takeover: {
      state: "active",
      target: {
        threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
        name: "Running target",
        cwd: "/workspace/project",
      },
    },
  });
  const rendered = JSON.stringify(card);
  assert.match(rendered, /Lark Remote 状态/);
  assert.match(rendered, /线程派发/);
  assert.match(rendered, /交给控制 Codex 窗口作为线程派发请求/);
  assert.match(rendered, /Running target/);
  assert.match(rendered, /配置验证/);
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
  assert.equal(active.split("\n")[0], "Current migration");
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
  const confirmCard = buildTakeoverConfirmCard(target);
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
  assert.equal(confirmCard.header.title.content, "当前会话");
  assert.match(confirmCard.elements[0].content, /^\*\*确认接管\*\*\n状态:/);
  assert.doesNotMatch(confirmCard.elements[0].content, /当前会话/);
  assert.doesNotMatch(rendered, /查看|列表|View|Observe|Takeover|List|Confirm takeover|Cancel/);
});

test("takeover project and session cards paginate three items at a time", () => {
  const projects = Array.from({ length: 5 }, (_, index) => ({
    index: index + 1,
    name: `project-${index + 1}`,
    cwd: `/workspace/project-${index + 1}`,
    windowCount: index + 1,
    activeWindowCount: index === 3 ? 1 : 0,
  }));
  const targets = Array.from({ length: 4 }, (_, index) => ({
    index: index + 1,
    status: index === 3 ? "running" : "idle",
    threadId: `019e0ffb-52e9-7ee3-bb87-42019b58eaa${index + 1}`,
    name: `session-${index + 1}`,
  }));

  const firstProjects = JSON.stringify(buildTakeoverProjectListCard(projects));
  const nextProjects = JSON.stringify(buildTakeoverProjectListCard(projects, { page: 1 }));
  const firstTargets = JSON.stringify(buildTakeoverListCard(targets));
  const nextTargets = JSON.stringify(buildTakeoverListCard(targets, { page: 1 }));

  assert.match(firstProjects, /project-1/);
  assert.match(firstProjects, /project-3/);
  assert.doesNotMatch(firstProjects, /project-4/);
  assert.match(firstProjects, /下一组/);
  assert.match(nextProjects, /project-4/);
  assert.match(nextProjects, /project-5/);
  assert.doesNotMatch(nextProjects, /project-1/);
  assert.match(nextProjects, /上一组/);

  assert.match(firstTargets, /session-1/);
  assert.match(firstTargets, /session-3/);
  assert.doesNotMatch(firstTargets, /session-4/);
  assert.match(nextTargets, /session-4/);
  assert.doesNotMatch(nextTargets, /session-1/);

  assert.match(formatTakeoverProjectList(projects), /1-3\/5/);
  assert.doesNotMatch(formatTakeoverProjectList(projects), /project-4/);
  assert.match(formatTakeoverList(targets), /1-3\/4/);
  assert.doesNotMatch(formatTakeoverList(targets), /session-4/);
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
  const discarded = formatPendingTakeoverInputDiscarded({}, { language: "zh" });

  assert.match(formatTakeoverStatus(null), /已关闭/);
  assert.match(status, /线程派发待处理/);
  assert.match(status, /线程: 019e0ffb/);
  assert.match(discarded, /没有已连接的专用 Codex 控制窗口/);
  assert.doesNotMatch(`${status}\n${discarded}`, /Queued|Pending messages|Target thread|待发送消息/);
});

test("formatHandoffSessionBusy explains that Lark input is discarded while desktop is active", () => {
  const text = formatHandoffSessionBusy(
    { threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2" },
    { reason: "last event running" },
  );

  assert.match(text, /正在 Codex Desktop 中执行/);
  assert.match(text, /没有发送，也不会排队/);
  assert.match(text, /线程: 019e0ffb/);
});

test("formatTakeoverActive includes an idle session recap when available", () => {
  const rendered = formatTakeoverActive(
    { threadId: "019e0000-0000-7000-8000-000000000099" },
    { recap: { finalMessage: "上个任务已经完成，并通过了 npm test。" } },
  );

  assert.match(rendered, /已接管目标线程/);
  assert.doesNotMatch(rendered, /现在发送普通飞书消息/);
  assert.doesNotMatch(rendered, /JS 不会把消息直接发送到目标线程/);
  assert.match(rendered, /上个任务同步/);
  assert.match(rendered, /上个任务已经完成/);
});

test("takeover cancellation and timeout messages separate preparation from active handoff", () => {
  const handoff = { active: true, threadId: "019e0000-0000-7000-8000-000000000001" };
  const takeover = {
    state: "pending",
    pendingInputs: [{ text: "继续" }],
    target: { threadId: "019e0000-0000-7000-8000-000000000002" },
  };

  assert.match(formatHandoffModeUnavailable(), /当前没有正在接管/);
  assert.match(formatTakeoverPreparationCancelled({ takeover, handoff }), /已取消当前接管选择\/等待/);
  assert.match(formatTakeoverPreparationCancelled({ takeover, handoff }), /暂存的消息不会发送/);
  assert.match(formatTakeoverPreparationCancelled({ takeover, handoff }), /原来的控制窗口派发状态/);
  assert.match(formatTakeoverTimedOut({ takeover, handoff }), /接管等待已超时/);
  assert.match(formatTakeoverTimedOut({ takeover, handoff }), /已回到原来的控制窗口派发状态/);
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
