import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runApprovedAction, splitCommand } from "../src/actions.mjs";
import { RemoteCommandQueue } from "../src/queue.mjs";

test("splitCommand handles quoted arguments", () => {
  assert.deepEqual(splitCommand('node -e "console.log(1)"'), ["node", "-e", "console.log(1)"]);
  assert.deepEqual(splitCommand("'npm' 'test'"), ["npm", "test"]);
});

test("runApprovedAction executes configured test command and records summary", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-actions-"));
  const queue = new RemoteCommandQueue({ dataDir: dir });
  const created = await queue.enqueue({
    repoKey: "demo",
    projectRoot: dir,
    prompt: "validate",
  });
  await queue.update(created.id, { status: "waiting_review", worktreePath: dir }, "ready");

  const updated = await runApprovedAction({
    queue,
    config: {
      repos: {
        demo: {
          testCommand: `"${process.execPath}" -e "console.log('ok')"`,
        },
      },
    },
    commandId: created.id,
    action: "test",
  });

  assert.equal(updated.status, "waiting_review");
  assert.match(updated.testSummary, /Command passed/);
  assert.match(updated.testSummary, /ok/);
  assert.deepEqual(updated.approvedActions, ["test"]);
});

test("runApprovedAction rejects gated actions before a task reaches review", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-actions-"));
  const queue = new RemoteCommandQueue({ dataDir: dir });
  const created = await queue.enqueue({
    repoKey: "demo",
    projectRoot: dir,
    prompt: "validate",
  });

  await assert.rejects(
    runApprovedAction({
      queue,
      config: { repos: { demo: { testCommand: "node --version" } } },
      commandId: created.id,
      action: "test",
    }),
    /Cannot approve test while task is pending/,
  );

  const unchanged = await queue.get(created.id);
  assert.deepEqual(unchanged.approvedActions, []);
});
