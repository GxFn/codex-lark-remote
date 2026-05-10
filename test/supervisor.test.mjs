import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bridgeStatus } from "../plugins/codex-lark-remote/src/supervisor.mjs";
import { stateFilePath } from "../plugins/codex-lark-remote/src/config.mjs";

test("bridgeStatus requests restart when the running bridge has no version", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-supervisor-"));
  const token = "test-token";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return new Response(`${JSON.stringify({ success: true, data: { text: "old bridge" } })}\n`, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await fs.writeFile(
      stateFilePath(dataDir),
      `${JSON.stringify({ pid: process.pid, url: "http://127.0.0.1:12345", token }, null, 2)}\n`,
    );

    const status = await bridgeStatus({ dataDir });
    assert.equal(status.running, false);
    assert.equal(status.restartRequired, true);
    assert.match(status.message, /Bridge version is unknown/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bridgeStatus removes stale bridge state when the stored endpoint is gone", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-stale-"));
  const statePath = stateFilePath(dataDir);
  await fs.writeFile(
    statePath,
    `${JSON.stringify({ pid: 1, url: "http://127.0.0.1:9", token: "stale-token" }, null, 2)}\n`,
  );

  const status = await bridgeStatus({ dataDir });
  assert.equal(status.running, false);
  assert.match(status.message, /Removed stale bridge state/);
  await assert.rejects(fs.stat(statePath), { code: "ENOENT" });
});
