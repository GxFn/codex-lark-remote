import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { diagnoseLarkRemote, formatDiagnostics, formatHandoff } from "../src/diagnostics.mjs";

test("diagnoseLarkRemote reports sanitized websocket-first readiness", async () => {
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
  assert.equal(diagnostics.checks.webSocketEnabled, true);
  assert.equal(diagnostics.checks.allowedUsersConfigured, true);
  assert.equal(diagnostics.bridge.webhookUrl, "https://codex.example.test/bridge/lark/event");
  assert.equal(diagnostics.paths.configPath, configPath);
  assert.equal(diagnostics.lark.appIdPrefix, "cli_1234...");
  assert.equal(diagnostics.lark.allowedUsersCount, 1);
  assert.equal(diagnostics.repos[0].pathExists, true);
  assert.match(formatDiagnostics(diagnostics), /Feishu\/Lark: websocket/);
  assert.doesNotMatch(formatHandoff(diagnostics), /\[repo\]|approve|worktree|isolated/i);
  assert.match(formatHandoff(diagnostics), /Send 控制台 or console/);
  assert.match(formatHandoff(diagnostics), /project list, session list/);
  assert.doesNotMatch(formatDiagnostics(diagnostics), /secret_value|token_value|0123456789abcdef/);
});

test("formatHandoff gives first-run setup guidance when app credentials are missing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-first-run-"));
  const diagnostics = await diagnoseLarkRemote({ dataDir: dir });
  const text = formatHandoff(diagnostics);

  assert.equal(diagnostics.checks.appCredentialsConfigured, false);
  assert.match(text, /configuration required/);
  assert.match(text, /Bridge: not started/);
  assert.match(text, /open\.feishu\.cn/);
  assert.match(text, /open\.larksuite\.com/);
  assert.match(text, /card\.action\.trigger/);
  assert.match(text, /allowedUsers: \[\]/);
  assert.match(text, /whoami/);
  assert.match(text, /explicit consent|明确同意/);
  assert.match(text, /clipboard/);
  assert.match(text, /已复制/);
  assert.match(text, /lark_verify_setup/);
  assert.doesNotMatch(text, /Current thread: [0-9a-f-]{36}/);
  assert.match(text, /lark_configure/);
  assert.doesNotMatch(formatDiagnostics(diagnostics), /Run lark_start/);
  assert.doesNotMatch(formatDiagnostics(diagnostics), /repos|worktree|isolated/i);
});
