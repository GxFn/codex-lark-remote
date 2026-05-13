import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { routeChatTextAction, classifyHandoffDirectText, intentToAction } from "../plugins/codex-lark-remote/src/intent-router.mjs";
import { setIntentSessionMode } from "../plugins/codex-lark-remote/src/intent-state.mjs";

test("handoff direct mode sends ordinary control-looking text to Codex", () => {
  assert.deepEqual(classifyHandoffDirectText("窗口列表", { defaultRepo: "main", repos: { main: {} } }), {
    kind: "task",
    forced: false,
    repoKey: "main",
    taskText: "窗口列表",
  });
  assert.deepEqual(classifyHandoffDirectText("验证配置", { defaultRepo: "main", repos: { main: {} } }), {
    kind: "task",
    forced: false,
    repoKey: "main",
    taskText: "验证配置",
  });
  assert.deepEqual(classifyHandoffDirectText("控制台", {}), { kind: "intent_console_enable" });
  assert.deepEqual(classifyHandoffDirectText("console", {}), { kind: "intent_console_enable" });
  assert.deepEqual(classifyHandoffDirectText("退出接管", {}), { kind: "handoff_disable" });
  assert.deepEqual(classifyHandoffDirectText("exit handoff", {}), { kind: "handoff_disable" });
  assert.deepEqual(classifyHandoffDirectText("关闭飞书连接", {}), { kind: "bridge_stop_confirm" });
  assert.deepEqual(classifyHandoffDirectText("close Lark connection", {}), { kind: "bridge_stop_confirm" });
});

test("console route uses Codex intent translator for unrecognized natural language", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-intent-router-"));
  const event = { text: "帮我判断一下这个说法", chatId: "oc_chat", chatIdHash: "c_chat", userIdHash: "u_user" };
  await setIntentSessionMode({ dataDir, event, mode: "console", reason: "test" });
  const action = await routeChatTextAction(
    {
      config: { dataDir, intent: { mode: "hybrid", translator: { minConfidence: 0.75 } } },
      intentTranslator: async () => ({ intent: "takeover.list_projects", args: {}, confidence: 0.9 }),
    },
    event,
    { kind: "task", taskText: event.text },
  );

  assert.deepEqual(action, { kind: "takeover_list" });
});

test("console route recognizes common project and window phrases without translator", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-intent-router-rules-"));
  const baseEvent = { chatId: "oc_chat", chatIdHash: "c_chat", userIdHash: "u_user" };
  await setIntentSessionMode({ dataDir, event: baseEvent, mode: "console", reason: "test" });
  const ctx = {
    config: { dataDir, intent: { mode: "hybrid", translator: { minConfidence: 0.75 } } },
    intentTranslator: async () => {
      throw new Error("translator should not be called for local console rules");
    },
  };

  assert.deepEqual(
    await routeChatTextAction(ctx, { ...baseEvent, text: "看看有哪些项目" }, { kind: "task", taskText: "看看有哪些项目" }),
    { kind: "takeover_list" },
  );
  assert.deepEqual(
    await routeChatTextAction(ctx, { ...baseEvent, text: "show projects" }, { kind: "task", taskText: "show projects" }),
    { kind: "takeover_list" },
  );
  assert.deepEqual(
    await routeChatTextAction(ctx, { ...baseEvent, text: "窗口列表" }, { kind: "takeover_list" }),
    { kind: "takeover_window_list" },
  );
  assert.deepEqual(
    await routeChatTextAction(ctx, { ...baseEvent, text: "会话列表" }, { kind: "takeover_list" }),
    { kind: "takeover_window_list" },
  );
  assert.deepEqual(
    await routeChatTextAction(ctx, { ...baseEvent, text: "session list" }, { kind: "takeover_list" }),
    { kind: "takeover_window_list" },
  );
  assert.deepEqual(
    await routeChatTextAction(ctx, { ...baseEvent, text: "进入项目 1" }, { kind: "task", taskText: "进入项目 1" }),
    { kind: "takeover_project_select", selector: "1" },
  );
  assert.deepEqual(
    await routeChatTextAction(ctx, { ...baseEvent, text: "enter project 1" }, { kind: "task", taskText: "enter project 1" }),
    { kind: "takeover_project_select", selector: "1" },
  );
  assert.deepEqual(
    await routeChatTextAction(ctx, { ...baseEvent, text: "第 2 个窗口" }, { kind: "task", taskText: "第 2 个窗口" }),
    { kind: "takeover_select", selector: "2" },
  );
  assert.deepEqual(
    await routeChatTextAction(ctx, { ...baseEvent, text: "会话 2" }, { kind: "task", taskText: "会话 2" }),
    { kind: "takeover_select", selector: "2" },
  );
  assert.deepEqual(
    await routeChatTextAction(ctx, { ...baseEvent, text: "select session 2" }, { kind: "task", taskText: "select session 2" }),
    { kind: "takeover_select", selector: "2" },
  );
  assert.deepEqual(
    await routeChatTextAction(ctx, { ...baseEvent, text: "观察第 2 个窗口" }, { kind: "observe_enable", selector: "2" }),
    { kind: "takeover_observe", selector: "2" },
  );
  assert.deepEqual(
    await routeChatTextAction(ctx, { ...baseEvent, text: "observe session 2" }, { kind: "observe_enable", selector: "2" }),
    { kind: "takeover_observe", selector: "2" },
  );
  assert.deepEqual(
    await routeChatTextAction(ctx, { ...baseEvent, text: "接管 1" }, { kind: "task", taskText: "接管 1" }),
    { kind: "takeover_confirm", selector: "1" },
  );
  assert.deepEqual(
    await routeChatTextAction(ctx, { ...baseEvent, text: "takeover 1" }, { kind: "task", taskText: "takeover 1" }),
    { kind: "takeover_confirm", selector: "1" },
  );
  assert.deepEqual(
    await routeChatTextAction(ctx, { ...baseEvent, text: "关闭飞书连接" }, { kind: "bridge_stop_confirm" }),
    { kind: "bridge_stop_confirm" },
  );
  assert.deepEqual(
    await routeChatTextAction(ctx, { ...baseEvent, text: "close Lark connection" }, { kind: "bridge_stop_confirm" }),
    { kind: "bridge_stop_confirm" },
  );
});

test("intent clarify hides internal translator failures", () => {
  assert.deepEqual(
    intentToAction({ intent: "unknown", reason: "codex translator failed: Reading additional input from stdin..." }),
    { kind: "intent_clarify", reason: "我还没识别出这条控制指令。" },
  );
});

test("takeover execute intent maps to confirmation instead of direct execution", () => {
  assert.deepEqual(
    intentToAction({ intent: "takeover.execute", args: { selector: "2" }, confidence: 0.95 }),
    { kind: "takeover_confirm", selector: "2" },
  );
});

test("bridge stop intent maps to a confirmation action", () => {
  assert.deepEqual(
    intentToAction({ intent: "bridge.stop", args: {}, confidence: 0.95, needsConfirmation: true }),
    { kind: "bridge_stop_confirm" },
  );
});
