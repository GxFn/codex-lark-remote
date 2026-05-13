import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readHandoff } from "../plugins/codex-lark-remote/src/handoff.mjs";
import {
  appendPendingTakeoverInput,
  buildPendingTakeoverPrompt,
  clearTakeover,
  detectSessionStatus,
  executeTakeoverTarget,
  prepareTakeoverScope,
  readTakeover,
  refreshTakeoverSelection,
  selectTakeoverTarget,
} from "../plugins/codex-lark-remote/src/takeover.mjs";

test("takeover scope lists project windows and excludes the starter thread", async () => {
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

  assert.equal(targets.length, 1);
  assert.equal(targets[0].name, "Target A");
  assert.equal(state.selection.options[0].index, 1);
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

test("executing an idle takeover target activates handoff", async () => {
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
  assert.equal(executed.handoff.threadId, "019e0000-0000-7000-8000-000000000004");
  assert.equal((await readHandoff({ dataDir })).threadId, "019e0000-0000-7000-8000-000000000004");
});

test("executing a running takeover target enters pending and queues input", async () => {
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
  const queued = await appendPendingTakeoverInput({ dataDir, text: "继续补测试", messageId: "om_2" });

  assert.equal(executed.pending, true);
  assert.equal((await readTakeover({ dataDir })).state, "pending");
  assert.equal(queued.pendingInputs.length, 1);
  assert.match(buildPendingTakeoverPrompt(queued.pendingInputs), /继续补测试/);
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
