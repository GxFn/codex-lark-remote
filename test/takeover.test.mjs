import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readHandoff } from "../src/handoff.mjs";
import {
  activatePendingTakeoverIfIdle,
  clearPendingTakeoverInputs,
  clearTakeover,
  detectSessionStatus,
  executeTakeoverTarget,
  listTakeoverProjects,
  prepareTakeoverScope,
  readTakeover,
  refreshTakeoverProjectSelection,
  refreshTakeoverSelection,
  selectTakeoverProject,
  selectTakeoverTarget,
} from "../src/takeover.mjs";

test("takeover scope lists every project window including the starter thread", async () => {
  const { dataDir, codexHome, sessions } = await fixture();
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-00-00-019e0000-0000-7000-8000-000000000001.jsonl"),
    id: "019e0000-0000-7000-8000-000000000001",
    cwd: "/workspace/project",
    name: "Starter B",
    mtime: new Date("2026-05-13T10:00:00Z"),
  });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-01-00-019e0000-0000-7000-8000-000000000002.jsonl"),
    id: "019e0000-0000-7000-8000-000000000002",
    cwd: "/workspace/project",
    name: "Target A",
    mtime: new Date("2026-05-13T10:01:00Z"),
  });

  await prepareTakeoverScope({
    dataDir,
    codexHome,
    cwd: "/workspace/project",
    threadId: "019e0000-0000-7000-8000-000000000001",
  });
  const { targets, state } = await refreshTakeoverSelection({ dataDir, codexHome, cwd: "/workspace/project" });

  assert.deepEqual(targets.map((target) => target.name), ["Target A", "Starter B"]);
  assert.equal(state.selection.options[0].index, 1);
  assert.equal(state.selection.options[1].index, 2);
});

test("takeover project selection groups windows by project before listing windows", async () => {
  const { dataDir, codexHome, sessions } = await fixture();
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-00-00-019e0000-0000-7000-8000-000000000010.jsonl"),
    id: "019e0000-0000-7000-8000-000000000010",
    cwd: "/workspace/alpha",
    name: "Alpha A",
    mtime: new Date("2026-05-13T10:00:00Z"),
  });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-01-00-019e0000-0000-7000-8000-000000000011.jsonl"),
    id: "019e0000-0000-7000-8000-000000000011",
    cwd: "/workspace/beta",
    name: "Beta B",
    mtime: new Date("2026-05-13T10:01:00Z"),
  });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-02-00-019e0000-0000-7000-8000-000000000012.jsonl"),
    id: "019e0000-0000-7000-8000-000000000012",
    cwd: "/workspace/beta",
    name: "Beta C",
    mtime: new Date("2026-05-13T10:02:00Z"),
  });

  const projects = await listTakeoverProjects({ codexHome });
  assert.equal(projects[0].cwd, "/workspace/beta");
  assert.equal(projects[0].windowCount, 2);

  const listed = await refreshTakeoverProjectSelection({ dataDir, codexHome });
  assert.equal(listed.state.state, "selecting_project");
  assert.equal(listed.state.projectSelection.options[0].cwd, "/workspace/beta");
  const takeoverPath = path.join(dataDir, "takeover.json");
  const staleState = JSON.parse(await fs.readFile(takeoverPath, "utf8"));
  staleState.projectSelection.options[0].windowCount = 1;
  await fs.writeFile(takeoverPath, `${JSON.stringify(staleState, null, 2)}\n`);

  const selected = await selectTakeoverProject({ dataDir, codexHome, selector: "1" });
  assert.equal(selected.project.cwd, "/workspace/beta");
  assert.equal(selected.project.windowCount, 2);
  assert.equal((await readTakeover({ dataDir })).project.windowCount, 2);
  assert.equal(selected.state.state, "selecting");
  assert.deepEqual(selected.targets.map((target) => target.name), ["Beta C", "Beta B"]);
});

test("takeover project and session lists use Codex sidebar titles", async () => {
  const { dataDir, codexHome, sessions } = await fixture();
  const targetId = "019e0000-0000-7000-8000-000000000020";
  await writeSession({
    file: path.join(sessions, `rollout-2026-05-13T10-02-00-${targetId}.jsonl`),
    id: targetId,
    cwd: "/workspace/project",
    name: "负责 codex-lark-remote 仓库的功能，检查这个问题并修复",
    mtime: new Date("2026-05-13T10:02:00Z"),
  });
  await fs.writeFile(
    path.join(codexHome, "session_index.jsonl"),
    `${JSON.stringify({
      id: targetId,
      thread_name: "检查并修复 codex-lark-remote 功能",
      updated_at: "2026-05-13T10:02:00Z",
    })}\n`,
  );

  const projects = await listTakeoverProjects({ codexHome });
  assert.equal(projects[0].latestWindowName, "检查并修复 codex-lark-remote 功能");

  await prepareTakeoverScope({ dataDir, codexHome, cwd: "/workspace/project" });
  const { targets, state } = await refreshTakeoverSelection({ dataDir, codexHome, cwd: "/workspace/project" });

  assert.equal(targets[0].name, "检查并修复 codex-lark-remote 功能");
  assert.equal(state.selection.options[0].name, "检查并修复 codex-lark-remote 功能");
});

test("takeover project and window lists prioritize active sessions", async () => {
  const { dataDir, codexHome, sessions } = await fixture();
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-00-00-019e0000-0000-7000-8000-000000000030.jsonl"),
    id: "019e0000-0000-7000-8000-000000000030",
    cwd: "/workspace/alpha",
    name: "Active older",
    events: [{ type: "event_msg", payload: { type: "agent_reasoning", message: "working" } }],
    mtime: new Date("2026-05-13T10:00:00Z"),
  });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-03-00-019e0000-0000-7000-8000-000000000031.jsonl"),
    id: "019e0000-0000-7000-8000-000000000031",
    cwd: "/workspace/alpha",
    name: "Idle newer",
    events: [{ type: "turn.completed", payload: {} }],
    mtime: new Date("2026-05-13T10:03:00Z"),
  });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-04-00-019e0000-0000-7000-8000-000000000032.jsonl"),
    id: "019e0000-0000-7000-8000-000000000032",
    cwd: "/workspace/beta",
    name: "Idle project",
    events: [{ type: "turn.completed", payload: {} }],
    mtime: new Date("2026-05-13T10:04:00Z"),
  });

  const projects = await listTakeoverProjects({ codexHome, idleDebounceMs: 60_000 });
  assert.equal(projects[0].cwd, "/workspace/alpha");
  assert.equal(projects[0].activeWindowCount, 1);

  await prepareTakeoverScope({ dataDir, codexHome, cwd: "/workspace/alpha" });
  const { targets } = await refreshTakeoverSelection({
    dataDir,
    codexHome,
    cwd: "/workspace/alpha",
    idleDebounceMs: 60_000,
  });
  assert.deepEqual(targets.map((target) => target.name), ["Active older", "Idle newer"]);
});

test("takeover project and window lists skip archived sessions", async () => {
  const { dataDir, codexHome, sessions } = await fixture();
  const archivedSessions = path.join(codexHome, "archived_sessions");
  await fs.mkdir(archivedSessions, { recursive: true });
  const archivedId = "019e0000-0000-7000-8000-000000000040";
  await writeSession({
    file: path.join(sessions, `rollout-2026-05-13T10-00-00-${archivedId}.jsonl`),
    id: archivedId,
    cwd: "/workspace/archived-only",
    name: "Archived window",
    mtime: new Date("2026-05-13T10:00:00Z"),
  });
  await writeSession({
    file: path.join(archivedSessions, `rollout-2026-05-13T10-00-00-${archivedId}.jsonl`),
    id: archivedId,
    cwd: "/workspace/archived-only",
    name: "Archived window",
    mtime: new Date("2026-05-13T10:00:00Z"),
  });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-01-00-019e0000-0000-7000-8000-000000000041.jsonl"),
    id: "019e0000-0000-7000-8000-000000000041",
    cwd: "/workspace/active",
    name: "Active window",
    mtime: new Date("2026-05-13T10:01:00Z"),
  });

  const projects = await listTakeoverProjects({ codexHome });
  assert.deepEqual(projects.map((project) => project.cwd), ["/workspace/active"]);

  await prepareTakeoverScope({ dataDir, codexHome, cwd: "/workspace/archived-only" });
  const { targets } = await refreshTakeoverSelection({
    dataDir,
    codexHome,
    cwd: "/workspace/archived-only",
  });
  assert.deepEqual(targets, []);
});

test("selecting a takeover target only stores selected state", async () => {
  const { dataDir, codexHome, sessions } = await fixture();
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-01-00-019e0000-0000-7000-8000-000000000003.jsonl"),
    id: "019e0000-0000-7000-8000-000000000003",
    cwd: "/workspace/project",
    name: "Target A",
    mtime: new Date("2026-05-13T10:01:00Z"),
  });
  await prepareTakeoverScope({ dataDir, codexHome, cwd: "/workspace/project" });
  await refreshTakeoverSelection({ dataDir, codexHome, cwd: "/workspace/project" });

  const selected = await selectTakeoverTarget({ dataDir, codexHome, selector: "1" });

  assert.equal(selected.state.state, "selected");
  assert.equal(selected.target.threadId, "019e0000-0000-7000-8000-000000000003");
  assert.equal(await readHandoff({ dataDir }), null);
});

test("executing an idle takeover target enables controller dispatch", async () => {
  const { dataDir, codexHome, sessions } = await fixture();
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-01-00-019e0000-0000-7000-8000-000000000004.jsonl"),
    id: "019e0000-0000-7000-8000-000000000004",
    cwd: "/workspace/project",
    name: "Idle target",
    events: [{ type: "turn.completed", payload: {} }],
    mtime: new Date("2026-05-13T10:01:00Z"),
  });
  await prepareTakeoverScope({ dataDir, codexHome, cwd: "/workspace/project" });
  await refreshTakeoverSelection({ dataDir, codexHome, cwd: "/workspace/project" });

  const executed = await executeTakeoverTarget({ dataDir, codexHome, selector: "1" });

  assert.equal(executed.pending, false);
  assert.equal(executed.handoff, null);
  assert.equal(executed.state.state, "active");
  assert.equal(executed.state.mode, "dispatch");
  assert.equal(executed.target.threadId, "019e0000-0000-7000-8000-000000000004");
  assert.equal(executed.dispatch.mode, "controller");
  assert.equal(await readHandoff({ dataDir }), null);
});

test("executing a running takeover target still enables controller dispatch", async () => {
  const { dataDir, codexHome, sessions } = await fixture();
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-01-00-019e0000-0000-7000-8000-000000000005.jsonl"),
    id: "019e0000-0000-7000-8000-000000000005",
    cwd: "/workspace/project",
    name: "Running target",
    events: [{ type: "event_msg", payload: { type: "agent_reasoning", message: "working" } }],
    mtime: new Date(),
  });
  await prepareTakeoverScope({ dataDir, codexHome, cwd: "/workspace/project" });
  await refreshTakeoverSelection({ dataDir, codexHome, cwd: "/workspace/project", idleDebounceMs: 60_000 });

  const executed = await executeTakeoverTarget({ dataDir, codexHome, selector: "1", idleDebounceMs: 60_000 });

  assert.equal(executed.pending, false);
  const takeover = await readTakeover({ dataDir });
  assert.equal(takeover.pendingAt, "");
  assert.equal(takeover.state, "active");
  assert.equal(takeover.mode, "dispatch");
  assert.equal(takeover.target.status, "running");
  assert.deepEqual(takeover.pendingInputs, []);

  const cleared = await clearPendingTakeoverInputs({ dataDir });
  assert.deepEqual(cleared.pendingInputs, []);
});

test("pending takeover times out when the target never becomes idle", async () => {
  const { dataDir, codexHome, sessions } = await fixture();
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-01-00-019e0000-0000-7000-8000-000000000015.jsonl"),
    id: "019e0000-0000-7000-8000-000000000015",
    cwd: "/workspace/project",
    name: "Long running target",
    events: [{ type: "event_msg", payload: { type: "agent_reasoning", message: "still working" } }],
    mtime: new Date(),
  });
  await prepareTakeoverScope({ dataDir, codexHome, cwd: "/workspace/project" });
  await refreshTakeoverSelection({ dataDir, codexHome, cwd: "/workspace/project", idleDebounceMs: 60_000 });
  await executeTakeoverTarget({ dataDir, codexHome, selector: "1", idleDebounceMs: 60_000 });

  const takeoverPath = path.join(dataDir, "takeover.json");
  const state = JSON.parse(await fs.readFile(takeoverPath, "utf8"));
  state.state = "pending";
  state.pendingAt = "2000-01-01T00:00:00.000Z";
  await fs.writeFile(takeoverPath, `${JSON.stringify(state, null, 2)}\n`);

  const result = await activatePendingTakeoverIfIdle({
    dataDir,
    codexHome,
    idleDebounceMs: 60_000,
    pendingTimeoutMs: 1,
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.state.state, "cancelled");
  assert.equal(await readTakeover({ dataDir }), null);
});

test("detectSessionStatus reads final and running session events", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-session-status-"));
  const idle = path.join(dir, "idle.jsonl");
  const running = path.join(dir, "running.jsonl");
  await fs.writeFile(idle, `${JSON.stringify({ type: "session_meta", payload: { id: "idle" } })}\n${JSON.stringify({ type: "turn.completed", payload: {} })}\n`);
  await fs.writeFile(running, `${JSON.stringify({ type: "session_meta", payload: { id: "running" } })}\n${JSON.stringify({ type: "event_msg", payload: { type: "agent_reasoning", message: "working" } })}\n`);

  assert.equal((await detectSessionStatus(idle)).status, "idle");
  assert.equal((await detectSessionStatus(running)).status, "running");
});

test("clearTakeover disables active takeover state", async () => {
  const { dataDir } = await fixture();
  await prepareTakeoverScope({ dataDir, cwd: "/workspace/project" });
  assert.equal((await readTakeover({ dataDir })).state, "selecting");

  await clearTakeover({ dataDir });
  assert.equal(await readTakeover({ dataDir }), null);
});

async function fixture() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-takeover-"));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-home-takeover-"));
  const sessions = path.join(codexHome, "sessions", "2026", "05", "13");
  await fs.mkdir(sessions, { recursive: true });
  return { dataDir, codexHome, sessions };
}

async function writeSession({ file, id, cwd, name = "", events = [], mtime }) {
  const lines = [
    JSON.stringify({
      type: "session_meta",
      payload: { id, cwd, name, source: "vscode" },
    }),
    ...events.map((event) => JSON.stringify(event)),
  ];
  await fs.writeFile(file, `${lines.join("\n")}\n`);
  await fs.utimes(file, mtime, mtime);
}
