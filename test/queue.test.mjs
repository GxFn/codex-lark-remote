import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RemoteCommandQueue } from "../src/queue.mjs";

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
    handoffDispatch: true,
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
  assert.equal(created.takeoverState, "active");
  assert.equal(created.dispatchTarget.threadId, "target-thread");

  const claimed = await queue.claimNext();
  assert.equal(claimed.handoffDispatch, true);
  assert.equal(claimed.controlWindowCommand, true);
  assert.equal(claimed.takeoverState, "active");
  assert.equal(claimed.dispatchTarget.threadId, "target-thread");
  assert.equal(claimed.dispatchTarget.name, "检查并修复 codex-lark-remote 功能");
});
