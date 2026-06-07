import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { activateHandoff, clearHandoff, listCodexThreads, markHandoffRemoteNoteSent, readHandoff, resolveCodexThread } from "../src/handoff.mjs";

test("activateHandoff stores an explicit thread id", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-handoff-"));
  const state = await activateHandoff({
    dataDir,
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    cwd: "/workspace",
    activatedBy: "test",
  });

  assert.equal(state.active, true);
  assert.equal(state.threadId, "019e0ffb-52e9-7ee3-bb87-42019b58eaa2");
  assert.equal((await readHandoff({ dataDir })).cwd, "/workspace");

  const cleared = await clearHandoff({ dataDir });
  assert.equal(cleared.active, false);
  assert.equal(await readHandoff({ dataDir }), null);
});

test("markHandoffRemoteNoteSent only marks once per handoff activation", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-handoff-note-"));
  await activateHandoff({
    dataDir,
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    cwd: "/workspace",
    activatedBy: "test",
  });

  assert.equal(await markHandoffRemoteNoteSent({
    dataDir,
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
  }), true);
  assert.match((await readHandoff({ dataDir })).remoteNoteSentAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(await markHandoffRemoteNoteSent({
    dataDir,
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
  }), false);
});

test("activateHandoff refuses to guess a thread when strict binding is required", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-handoff-strict-"));

  await assert.rejects(
    activateHandoff({ dataDir, requireExplicitThread: true, cwd: "/workspace" }),
    /Current Codex thread id is required/,
  );
});

test("activateHandoff refuses to guess a thread by default", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-handoff-default-strict-"));

  await assert.rejects(
    activateHandoff({ dataDir, cwd: "/workspace" }),
    /Current Codex thread id is required/,
  );
});

test("resolveCodexThread prefers the newest session matching cwd", async () => {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-home-"));
  const sessions = path.join(codexHome, "sessions", "2026", "05", "10");
  await fs.mkdir(sessions, { recursive: true });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-10T10-00-00-019e0000-0000-7000-8000-000000000001.jsonl"),
    id: "019e0000-0000-7000-8000-000000000001",
    cwd: "/other",
    mtime: new Date("2026-05-10T10:00:00Z"),
  });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-10T09-00-00-019e0000-0000-7000-8000-000000000002.jsonl"),
    id: "019e0000-0000-7000-8000-000000000002",
    cwd: "/workspace/project",
    mtime: new Date("2026-05-10T09:00:00Z"),
  });

  const resolved = await resolveCodexThread({ codexHome, cwd: "/workspace/project/packages/plugin" });

  assert.equal(resolved.threadId, "019e0000-0000-7000-8000-000000000002");
  assert.equal(resolved.cwd, "/workspace/project");
});

test("resolveCodexThread skips hidden subagent and exec sessions", async () => {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-home-"));
  const sessions = path.join(codexHome, "sessions", "2026", "05", "10");
  await fs.mkdir(sessions, { recursive: true });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-10T12-00-00-019e0000-0000-7000-8000-000000000003.jsonl"),
    id: "019e0000-0000-7000-8000-000000000003",
    cwd: "/workspace/project",
    source: { subagent: { other: "guardian" } },
    threadSource: "subagent",
    mtime: new Date("2026-05-10T12:00:00Z"),
  });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-10T11-30-00-019e0000-0000-7000-8000-000000000004.jsonl"),
    id: "019e0000-0000-7000-8000-000000000004",
    cwd: "/workspace/project",
    source: "exec",
    mtime: new Date("2026-05-10T11:30:00Z"),
  });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-10T11-00-00-019e0000-0000-7000-8000-000000000005.jsonl"),
    id: "019e0000-0000-7000-8000-000000000005",
    cwd: "/workspace/project",
    source: "vscode",
    mtime: new Date("2026-05-10T11:00:00Z"),
  });

  const resolved = await resolveCodexThread({ codexHome, cwd: "/workspace/project" });

  assert.equal(resolved.threadId, "019e0000-0000-7000-8000-000000000005");
});

test("listCodexThreads infers title from the first user message", async () => {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-home-title-"));
  const sessions = path.join(codexHome, "sessions", "2026", "05", "11");
  await fs.mkdir(sessions, { recursive: true });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-11T10-00-00-019e0000-0000-7000-8000-000000000006.jsonl"),
    id: "019e0000-0000-7000-8000-000000000006",
    cwd: "/workspace/project",
    userMessage: "分析说明 BiliDili 项目架构\n<codex_lark_remote_note>ignore</codex_lark_remote_note>",
    mtime: new Date("2026-05-11T10:00:00Z"),
  });

  const [thread] = await listCodexThreads({ codexHome, cwd: "/workspace/project" });

  assert.equal(thread.name, "分析说明 BiliDili 项目架构");
});

test("listCodexThreads skips AGENTS bootstrap messages when inferring title", async () => {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-home-title-agents-"));
  const sessions = path.join(codexHome, "sessions", "2026", "05", "11");
  await fs.mkdir(sessions, { recursive: true });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-11T10-00-00-019e0000-0000-7000-8000-000000000007.jsonl"),
    id: "019e0000-0000-7000-8000-000000000007",
    cwd: "/workspace/project",
    userMessages: [
      "# AGENTS.md instructions for /workspace/project",
      "继续实现飞书接管能力",
    ],
    mtime: new Date("2026-05-11T10:00:00Z"),
  });

  const [thread] = await listCodexThreads({ codexHome, cwd: "/workspace/project" });

  assert.equal(thread.name, "继续实现飞书接管能力");
});

async function writeSession({ file, id, cwd, source = "vscode", threadSource = "", userMessage = "", userMessages = [], mtime }) {
  const line = JSON.stringify({
    type: "session_meta",
    payload: { id, cwd, source, thread_source: threadSource },
  });
  const lines = [line];
  for (const message of [userMessage, ...userMessages].filter(Boolean)) {
    lines.push(JSON.stringify({
      type: "event_msg",
      payload: { type: "user_message", message },
    }));
  }
  await fs.writeFile(file, `${lines.join("\n")}\n`);
  await fs.utimes(file, mtime, mtime);
}
