import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { formatConfigUpdate, updateRuntimeConfig } from "../src/config-writer.mjs";

test("updateRuntimeConfig writes config and returns a sanitized summary", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-config-"));
  const repoPath = path.join(dataDir, "project");
  const result = await updateRuntimeConfig({
    dataDir,
    lark: {
      domain: "lark",
      appId: "cli_123456789",
      appSecret: "secret_value",
      verificationToken: "token_value",
      encryptKey: "encrypt_value",
      allowedUsers: ["ou_allowed"],
      transport: "websocket",
    },
    defaultRepo: "demo",
    repos: {
      demo: {
        path: repoPath,
        baseBranch: "main",
        testCommand: "npm test",
      },
    },
    takeover: {
      projectLimit: 30,
      selectionTtlMs: 120000,
    },
    startup: {
      receiveId: "oc_startup",
      receiveIdType: "chat_id",
      once: false,
    },
    intent: {
      mode: "hybrid",
      translator: { timeoutMs: 9000 },
    },
  });

  const saved = JSON.parse(await fs.readFile(result.configPath, "utf8"));
  assert.equal(saved.lark.domain, "lark");
  assert.equal(saved.lark.appSecret, "secret_value");
  assert.equal(saved.takeover.projectLimit, 30);
  assert.equal(saved.takeover.selectionTtlMs, 120000);
  assert.equal(saved.startup.receiveId, "oc_startup");
  assert.equal(saved.startup.once, false);
  assert.equal(saved.intent.mode, "hybrid");
  assert.equal(saved.intent.translator.timeoutMs, 9000);
  assert.equal(result.summary.lark.appIdPrefix, "cli_1234...");
  assert.equal(result.summary.lark.domainKey, "lark");
  assert.equal(result.summary.lark.baseUrl, "https://open.larksuite.com");
  assert.equal(result.summary.lark.appSecretConfigured, true);
  assert.equal(result.summary.lark.allowedUsersCount, 1);
  assert.equal(result.summary.startup.receiveIdConfigured, true);
  assert.deepEqual(result.summary.repoKeys, ["demo"]);

  const text = formatConfigUpdate(result);
  assert.match(text, /configuration saved/);
  assert.match(text, /Lark international/);
  assert.match(text, /Startup intro target: configured/);
  assert.match(text, /lark_verify_setup/);
  assert.match(text, /控制台 or console/);
  assert.doesNotMatch(text, /secret_value|token_value|encrypt_value/);
});

test("formatConfigUpdate guides first setup when allowedUsers is empty", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-config-first-"));
  const result = await updateRuntimeConfig({
    dataDir,
    lark: {
      appId: "cli_123456789",
      appSecret: "secret_value",
      allowedUsers: [],
      transport: "websocket",
    },
  });

  const text = formatConfigUpdate(result);
  assert.match(text, /Allowed users: 0/);
  assert.match(text, /explicit consent/i);
  assert.match(text, /Only after Codex confirms the connection is active, send whoami/i);
  assert.match(text, /lark\.allowedUsers/);
  assert.match(text, /Startup intro target: learn from first Feishu chat/);
  assert.doesNotMatch(text, /secret_value/);
});
