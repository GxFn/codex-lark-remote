import test from "node:test";
import assert from "node:assert/strict";
import {
  isLikelyDispatchPrompt,
  parseControlDirective,
  parseControlSemanticAction,
  parseDispatchDirective,
} from "../plugins/codex-lark-remote/src/control-semantics.mjs";

test("control semantics normalize project and session phrases", () => {
  assert.deepEqual(parseControlSemanticAction("项目列表", { mode: "console" }), { kind: "takeover_list" });
  assert.deepEqual(parseControlSemanticAction("project list", { mode: "console" }), { kind: "takeover_list" });
  assert.deepEqual(parseControlSemanticAction("show projects", { mode: "console" }), { kind: "takeover_list" });
  assert.deepEqual(parseControlSemanticAction("会话列表", { mode: "console" }), { kind: "takeover_window_list" });
  assert.deepEqual(parseControlSemanticAction("session list", { mode: "console" }), { kind: "takeover_window_list" });
  assert.deepEqual(parseControlSemanticAction("list windows", { mode: "console" }), { kind: "takeover_window_list" });
  assert.deepEqual(parseControlSemanticAction("进入项目 1", { mode: "console" }), { kind: "takeover_project_select", selector: "1" });
  assert.deepEqual(parseControlSemanticAction("进入第一个项目", { mode: "console" }), { kind: "takeover_project_select", selector: "1" });
  assert.deepEqual(parseControlSemanticAction("enter project 1", { mode: "console" }), { kind: "takeover_project_select", selector: "1" });
  assert.deepEqual(parseControlSemanticAction("open first project", { mode: "console" }), { kind: "takeover_project_select", selector: "1" });
  assert.deepEqual(parseControlSemanticAction("please show me projects", { mode: "console" }), { kind: "takeover_list" });
  assert.deepEqual(parseControlSemanticAction("please enter project two", { mode: "console" }), { kind: "takeover_project_select", selector: "2" });
  assert.deepEqual(parseControlSemanticAction("会话 2", { mode: "console" }), { kind: "takeover_select", selector: "2" });
  assert.deepEqual(parseControlSemanticAction("select session 2", { mode: "console" }), { kind: "takeover_select", selector: "2" });
  assert.deepEqual(parseControlSemanticAction("select the second session", { mode: "console" }), { kind: "takeover_select", selector: "2" });
  assert.deepEqual(parseControlSemanticAction("second window", { mode: "console" }), { kind: "takeover_select", selector: "2" });
});

test("control semantics separate console confirmation from global execution", () => {
  assert.deepEqual(parseControlSemanticAction("接管 1", { mode: "console" }), { kind: "takeover_confirm", selector: "1" });
  assert.deepEqual(parseControlSemanticAction("接管 1", { mode: "global" }), { kind: "takeover_execute", selector: "1" });
  assert.deepEqual(parseControlSemanticAction("takeover 1", { mode: "console" }), { kind: "takeover_confirm", selector: "1" });
  assert.deepEqual(parseControlSemanticAction("takeover 1", { mode: "global" }), { kind: "takeover_execute", selector: "1" });
  assert.deepEqual(parseControlSemanticAction("观察会话 2", { mode: "console" }), { kind: "takeover_observe", selector: "2" });
  assert.deepEqual(parseControlSemanticAction("观察会话 2", { mode: "global" }), { kind: "observe_enable", selector: "2" });
  assert.deepEqual(parseControlSemanticAction("observe session 2", { mode: "console" }), { kind: "takeover_observe", selector: "2" });
  assert.deepEqual(parseControlSemanticAction("observe session 2", { mode: "global" }), { kind: "observe_enable", selector: "2" });
  assert.deepEqual(parseControlSemanticAction("observe the second session", { mode: "console" }), { kind: "takeover_observe", selector: "2" });
  assert.deepEqual(parseControlSemanticAction("take over the second window", { mode: "console" }), { kind: "takeover_confirm", selector: "2" });
});

test("control semantics keep handoff exit and bridge stop distinct", () => {
  assert.deepEqual(parseControlSemanticAction("退出接管", { mode: "console" }), { kind: "handoff_disable" });
  assert.deepEqual(parseControlSemanticAction("exit handoff", { mode: "console" }), { kind: "handoff_disable" });
  assert.deepEqual(parseControlSemanticAction("断开接管", { mode: "console" }), { kind: "handoff_disable" });
  assert.deepEqual(parseControlSemanticAction("关闭飞书连接", { mode: "console" }), { kind: "bridge_stop_confirm" });
  assert.deepEqual(parseControlSemanticAction("确认关闭飞书连接", { mode: "console" }), { kind: "bridge_stop_execute" });
  assert.deepEqual(parseControlSemanticAction("confirm close Lark connection", { mode: "console" }), { kind: "bridge_stop_execute" });
  assert.deepEqual(parseControlSemanticAction("close Lark connection", { mode: "console" }), { kind: "bridge_stop_confirm" });
  assert.deepEqual(parseControlSemanticAction("断开连接", { mode: "console" }), { kind: "bridge_stop_confirm" });
  assert.deepEqual(parseControlSemanticAction("check status", { mode: "console" }), { kind: "status" });
  assert.deepEqual(parseControlSemanticAction("检查状态", { mode: "console" }), { kind: "status" });
});

test("control semantics do not steal task-like dispatch prompts", () => {
  assert.equal(parseControlSemanticAction("帮我实现项目列表分页", { mode: "console" }), null);
  assert.equal(parseControlSemanticAction("fix the project list component", { mode: "console" }), null);
  assert.equal(parseControlSemanticAction("修改 session list card title", { mode: "console" }), null);
  assert.equal(parseControlSemanticAction("分析第 2 个窗口为什么闪烁", { mode: "console" }), null);
  assert.equal(parseControlSemanticAction("请观察第二个测试用例为什么失败", { mode: "console" }), null);
  assert.equal(parseControlSemanticAction("review the takeover implementation", { mode: "console" }), null);
  assert.equal(isLikelyDispatchPrompt("帮我实现项目列表分页"), true);
  assert.equal(isLikelyDispatchPrompt("分析第 2 个窗口为什么闪烁"), true);
  assert.equal(isLikelyDispatchPrompt("please debug the session list card"), true);
});

test("control semantics support explicit control and dispatch directives", () => {
  assert.equal(parseControlDirective("控制: 项目列表"), "项目列表");
  assert.equal(parseControlDirective("请控制: 项目列表"), "项目列表");
  assert.equal(parseControlDirective("command: show projects"), "show projects");
  assert.equal(parseDispatchDirective("派发: 项目列表"), "项目列表");
  assert.equal(parseDispatchDirective("please dispatch: fix the project list component"), "fix the project list component");
  assert.equal(parseDispatchDirective("dispatch: fix the project list component"), "fix the project list component");
  assert.deepEqual(parseControlSemanticAction("控制: 项目列表", { mode: "console" }), { kind: "takeover_list" });
  assert.equal(parseControlSemanticAction("派发: 项目列表", { mode: "console" }), null);
});
