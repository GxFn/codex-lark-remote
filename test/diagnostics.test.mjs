import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { diagnoseLarkRemote, formatDiagnostics } from "../src/diagnostics.mjs";

test("diagnoseLarkRemote reports sanitized webhook readiness", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-diagnostics-"));
  const repoDir = path.join(dir, "repo");
  await fs.mkdir(repoDir);
  const configPath = path.join(dir, "config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        publicUrl: "https://codex.example.test/",
        lark: {
          appId: "cli_123456789",
          appSecret: "secret_value",
          verificationToken: "token_value",
          encryptKey: "0123456789abcdef0123456789abcdef",
          allowedUsers: ["ou_allowed"],
        },
        defaultRepo: "demo",
        repos: {
          demo: {
            path: repoDir,
            remote: "origin",
            baseBranch: "main",
            testCommand: "npm test",
          },
        },
      },
      null,
      2,
    ),
  );

  const diagnostics = await diagnoseLarkRemote({ dataDir: dir, configPath });
  assert.equal(diagnostics.ok, false);
  assert.equal(diagnostics.checks.bridgeRunning, false);
  assert.equal(diagnostics.checks.allowedUsersConfigured, true);
  assert.equal(diagnostics.bridge.webhookUrl, "https://codex.example.test/bridge/lark/event");
  assert.equal(diagnostics.lark.appIdPrefix, "cli_1234...");
  assert.equal(diagnostics.lark.allowedUsersCount, 1);
  assert.equal(diagnostics.repos[0].pathExists, true);
  assert.match(formatDiagnostics(diagnostics), /Webhook URL: https:\/\/codex\.example\.test\/bridge\/lark\/event/);
  assert.doesNotMatch(formatDiagnostics(diagnostics), /secret_value|token_value|0123456789abcdef/);
});
