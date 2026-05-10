import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { activateHandoff, clearHandoff, readHandoff, resolveCodexThread } from "../plugins/codex-lark-remote/src/handoff.mjs";

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

async function writeSession({ file, id, cwd, source = "vscode", threadSource = "", mtime }) {
  const line = JSON.stringify({
    type: "session_meta",
    payload: { id, cwd, source, thread_source: threadSource },
  });
  await fs.writeFile(file, `${line}\n`);
  await fs.utimes(file, mtime, mtime);
}
