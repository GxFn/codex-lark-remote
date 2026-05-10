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

