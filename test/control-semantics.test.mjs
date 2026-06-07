import test from "node:test";
import assert from "node:assert/strict";
import { parseControlSemanticAction } from "../src/control-semantics.mjs";

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
  assert.deepEqual(parseControlSemanticAction("会话 2", { mode: "console" }), { kind: "takeover_select", selector: "2" });
  assert.deepEqual(parseControlSemanticAction("select session 2", { mode: "console" }), { kind: "takeover_select", selector: "2" });
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
});

test("control semantics keep handoff exit and bridge stop distinct", () => {
  assert.deepEqual(parseControlSemanticAction("退出接管", { mode: "console" }), { kind: "handoff_disable" });
  assert.deepEqual(parseControlSemanticAction("exit handoff", { mode: "console" }), { kind: "handoff_disable" });
  assert.deepEqual(parseControlSemanticAction("断开接管", { mode: "console" }), { kind: "handoff_disable" });
  assert.deepEqual(parseControlSemanticAction("关闭飞书连接", { mode: "console" }), { kind: "bridge_stop_confirm" });
  assert.deepEqual(parseControlSemanticAction("close Lark connection", { mode: "console" }), { kind: "bridge_stop_confirm" });
  assert.deepEqual(parseControlSemanticAction("断开连接", { mode: "console" }), { kind: "bridge_stop_confirm" });
});
