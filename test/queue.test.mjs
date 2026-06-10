import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RemoteCommandQueue } from "../plugins/codex-lark-remote/src/queue.mjs";

test("RemoteCommandQueue enqueues, claims, updates, and cancels tasks", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-queue-"));
  const queue = new RemoteCommandQueue({ dataDir: dir });

  const created = await queue.enqueue({
    repoKey: "demo",
    projectRoot: "/tmp/demo",
    prompt: "fix tests",
  });
  assert.equal(created.status, "pending");

  const claimed = await queue.claimNext();
  assert.equal(claimed.id, created.id);
  assert.equal(claimed.status, "running");

  const updated = await queue.update(created.id, { status: "waiting_review", result: "done" }, "done");
  assert.equal(updated.status, "waiting_review");
  assert.equal(updated.result, "done");

  const cancelled = await queue.cancel(created.id);
  assert.equal(cancelled.status, "cancelled");
});

test("RemoteCommandQueue preserves thread handoff dispatch metadata", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-queue-dispatch-"));
  const queue = new RemoteCommandQueue({ dataDir: dir });

  const created = await queue.enqueue({
    source: "lark",
    mode: "thread_handoff",
    repoKey: "current",
    projectRoot: "/workspace",
    prompt: "继续检查",
    codexSessionId: "control-thread",
    controlWindowCommand: true,
    targetWindowDispatch: true,
    handoffDispatch: true,
    parentRemoteCommandId: "rcmd_parent",
    takeoverState: "active",
    dispatchTarget: {
      threadId: "target-thread",
      threadPath: "/tmp/target.jsonl",
      cwd: "/workspace",
      name: "检查并修复 codex-lark-remote 功能",
      status: "idle",
      statusReason: "last event idle",
    },
  });

  assert.equal(created.handoffDispatch, true);
  assert.equal(created.controlWindowCommand, true);
  assert.equal(created.targetWindowDispatch, true);
  assert.equal(created.parentRemoteCommandId, "rcmd_parent");
  assert.equal(created.takeoverState, "active");
  assert.equal(created.dispatchTarget.threadId, "target-thread");

  const claimed = await queue.claimNext();
  assert.equal(claimed.handoffDispatch, true);
  assert.equal(claimed.controlWindowCommand, true);
  assert.equal(claimed.targetWindowDispatch, true);
  assert.equal(claimed.parentRemoteCommandId, "rcmd_parent");
  assert.equal(claimed.takeoverState, "active");
  assert.equal(claimed.dispatchTarget.threadId, "target-thread");
  assert.equal(claimed.dispatchTarget.name, "检查并修复 codex-lark-remote 功能");
});

test("RemoteCommandQueue prioritizes local control-window commands", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-queue-priority-"));
  const queue = new RemoteCommandQueue({ dataDir: dir });

  const target = await queue.enqueue({
    source: "lark",
    mode: "thread_handoff",
    repoKey: "current",
    projectRoot: "/workspace",
    prompt: "[Lark Remote dispatch]\n修复问题",
    codexSessionId: "target-thread",
    targetWindowDispatch: true,
  });
  const control = await queue.enqueue({
    source: "lark",
    mode: "thread_handoff",
    repoKey: "current",
    projectRoot: "/workspace",
    prompt: "status",
    codexSessionId: "control-thread",
    controlWindowCommand: true,
  });

  assert.equal((await queue.claimNext()).id, control.id);
  assert.equal((await queue.claimNext()).id, target.id);
});

test("RemoteCommandQueue can claim only pending control-window commands", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-queue-control-only-"));
  const queue = new RemoteCommandQueue({ dataDir: dir });

  const target = await queue.enqueue({
    source: "lark",
    mode: "thread_handoff",
    repoKey: "current",
    projectRoot: "/workspace",
    prompt: "[Lark Remote dispatch]\n修复问题",
    codexSessionId: "target-thread",
    targetWindowDispatch: true,
  });
  const control = await queue.enqueue({
    source: "lark",
    mode: "thread_handoff",
    repoKey: "current",
    projectRoot: "/workspace",
    prompt: "status",
    codexSessionId: "control-thread",
    controlWindowCommand: true,
  });

  assert.equal((await queue.claimNextMatching((item) => item.controlWindowCommand === true)).id, control.id);
  assert.equal((await queue.claimNextMatching((item) => item.controlWindowCommand === true)), null);
  assert.equal((await queue.claimNext()).id, target.id);
});

test("RemoteCommandQueue serializes target-window dispatches for the same target thread", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-queue-target-serial-"));
  const queue = new RemoteCommandQueue({ dataDir: dir });

  const first = await queue.enqueue({
    source: "lark",
    mode: "thread_handoff",
    repoKey: "current",
    projectRoot: "/workspace",
    prompt: "first",
    codexSessionId: "target-thread",
    targetWindowDispatch: true,
  });
  const second = await queue.enqueue({
    source: "lark",
    mode: "thread_handoff",
    repoKey: "current",
    projectRoot: "/workspace",
    prompt: "second",
    codexSessionId: "target-thread",
    targetWindowDispatch: true,
  });

  assert.equal((await queue.claimNext({ runnerPid: process.pid, runnerId: "runner-a" })).id, first.id);
  assert.equal(await queue.claimNext({ runnerPid: process.pid, runnerId: "runner-a" }), null);

  await queue.update(first.id, { status: "completed", completedAt: new Date().toISOString() }, "done");
  assert.equal((await queue.claimNext({ runnerPid: process.pid, runnerId: "runner-a" })).id, second.id);
});

test("RemoteCommandQueue records claim ownership and heartbeats", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-queue-heartbeat-"));
  const queue = new RemoteCommandQueue({ dataDir: dir });

  const created = await queue.enqueue({
    repoKey: "demo",
    projectRoot: "/tmp/demo",
    prompt: "fix tests",
  });
  const claimed = await queue.claimNext({ runnerPid: 12345, runnerId: "runner-test" });

  assert.equal(claimed.id, created.id);
  assert.equal(claimed.runnerPid, 12345);
  assert.equal(claimed.runnerId, "runner-test");
  assert.match(claimed.runnerHeartbeatAt, /^\d{4}-\d{2}-\d{2}T/);

  const heartbeat = await queue.heartbeat(created.id, {
    at: "2026-06-10T00:00:00.000Z",
    runnerPid: 23456,
    runnerId: "runner-new",
  });
  assert.equal(heartbeat.runnerHeartbeatAt, "2026-06-10T00:00:00.000Z");
  assert.equal(heartbeat.runnerPid, 23456);
  assert.equal(heartbeat.runnerId, "runner-new");
});

test("RemoteCommandQueue serializes concurrent heartbeat and completion writes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-queue-concurrent-"));
  const queue = new RemoteCommandQueue({ dataDir: dir });

  const created = await queue.enqueue({
    source: "lark",
    mode: "thread_handoff",
    projectRoot: "/workspace",
    prompt: "dispatch",
    codexSessionId: "target-thread",
    targetWindowDispatch: true,
  });
  await queue.claimNext({ runnerPid: process.pid, runnerId: "runner-a" });

  await Promise.all([
    queue.heartbeat(created.id, {
      at: "2026-06-10T00:00:01.000Z",
      runnerPid: process.pid,
      runnerId: "runner-a",
    }),
    queue.update(
      created.id,
      { status: "completed", result: "done", completedAt: "2026-06-10T00:00:02.000Z" },
      "done",
    ),
  ]);

  const latest = await queue.get(created.id);
  assert.equal(latest.status, "completed");
  assert.equal(latest.result, "done");
});

test("RemoteCommandQueue recovers stale target dispatches instead of leaving them running forever", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-queue-stale-"));
  const queue = new RemoteCommandQueue({ dataDir: dir });

  const created = await queue.enqueue({
    source: "lark",
    mode: "thread_handoff",
    repoKey: "current",
    projectRoot: "/workspace",
    prompt: "stale dispatch",
    codexSessionId: "target-thread",
    targetWindowDispatch: true,
  });
  await queue.claimNext({ runnerPid: process.pid, runnerId: "old-runner" });
  await queue.update(
    created.id,
    { runnerHeartbeatAt: "2026-06-10T00:00:00.000Z" },
    "test_heartbeat_backdated",
  );

  const recovered = await queue.recoverStaleRunning({
    now: "2026-06-10T00:10:00.000Z",
    staleMs: 60_000,
    language: "zh",
  });

  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].id, created.id);
  assert.equal(recovered[0].status, "failed");
  assert.match(recovered[0].error, /执行器中断/);
  const latest = await queue.get(created.id);
  assert.equal(latest.status, "failed");
  assert.match(latest.completedAt, /^2026-06-10T00:10:00.000Z$/);
});
