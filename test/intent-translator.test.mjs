import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeIntent, parseIntentJson, translateTextToIntent } from "../src/intent-translator.mjs";

test("parseIntentJson accepts fenced JSON", () => {
  assert.deepEqual(parseIntentJson("```json\n{\"intent\":\"system.status\"}\n```"), { intent: "system.status" });
});

test("normalizeIntent rejects unknown intents and low confidence actions", () => {
  assert.equal(normalizeIntent({ intent: "bad.intent", confidence: 1 }).intent, "unknown");
  const low = normalizeIntent(
    { intent: "takeover.list_projects", confidence: 0.2, args: {} },
    { config: { intent: { translator: { minConfidence: 0.75 } } } },
  );
  assert.equal(low.intent, "clarify");
});

test("translateTextToIntent uses injected Codex translator adapter in tests", async () => {
  const intent = await translateTextToIntent({
    text: "看看有哪些项目",
    config: { intent: { translator: { minConfidence: 0.75 } } },
    translator: async () => ({
      schemaVersion: 1,
      intent: "takeover.list_projects",
      args: {},
      confidence: 0.95,
      needsConfirmation: false,
      reason: "test",
    }),
  });

  assert.equal(intent.intent, "takeover.list_projects");
});

test("translateTextToIntent does not pipe stdin into Codex exec", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-intent-translator-"));
  const fakeCodex = path.join(dataDir, "fake-codex");
  await fs.writeFile(fakeCodex, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "const stat = fs.fstatSync(0);",
    "if (stat.isFIFO()) {",
    "  console.error('Reading additional input from stdin...');",
    "  process.exit(2);",
    "}",
    "console.log(JSON.stringify({",
    "  type: 'agent_message',",
    "  message: JSON.stringify({ schemaVersion: 1, intent: 'takeover.list_projects', args: {}, confidence: 0.95, needsConfirmation: false, reason: 'ok' })",
    "}));",
    "",
  ].join("\n"));
  await fs.chmod(fakeCodex, 0o755);

  const intent = await translateTextToIntent({
    text: "随便看看",
    context: {},
    config: {
      runner: { codexPath: fakeCodex },
      intent: { mode: "hybrid", translator: { provider: "codex-thread", minConfidence: 0.75, timeoutMs: 5000 } },
    },
  });

  assert.equal(intent.intent, "takeover.list_projects");
});
