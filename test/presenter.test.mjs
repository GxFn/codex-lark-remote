import test from "node:test";
import assert from "node:assert/strict";
import { formatBridgeStatus, formatFinal, formatHelp, formatProgress, formatTask, formatWhoami } from "../plugins/codex-lark-remote/src/presenter.mjs";

test("formatHelp includes whoami command", () => {
  assert.match(formatHelp(), /\/codex whoami/);
});

test("formatWhoami returns the sender id needed for allowlist setup", () => {
  const text = formatWhoami({
    senderIdType: "user_id",
    senderId: "ou_user_123",
    openId: "ou_open_123",
    unionId: "on_union_123",
    userIdHash: "u_abc123",
  });

  assert.match(text, /senderIdType: user_id/);
  assert.match(text, /senderId: ou_user_123/);
  assert.match(text, /openId: ou_open_123/);
  assert.match(text, /unionId: on_union_123/);
  assert.match(text, /Add senderId to lark\.allowedUsers/);
});

test("formatBridgeStatus includes Mac keep-awake state", () => {
  const text = formatBridgeStatus({
    config: { lark: { transport: "websocket" } },
    counts: {},
    workerBusy: false,
    url: "http://127.0.0.1:1234",
    larkWs: { enabled: true, connected: true },
    handoff: { active: true, threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2" },
    keepAwake: { enabled: true, active: true, pid: 1234, platform: "darwin" },
  });

  assert.match(text, /Mac keep-awake: active pid=1234/);
});


test("formatTask exposes the last notification delivery error", () => {
  const text = formatTask({
    id: "rcmd_test",
    status: "waiting_review",
    repoKey: "repo",
    lastNotifyError: "message not found",
    result: "done",
  });

  assert.match(text, /Last notify error:/);
  assert.match(text, /message not found/);
});

test("formatTask includes agent progress summaries", () => {
  const text = formatTask({
    id: "rcmd_test",
    status: "completed",
    repoKey: "repo",
    progressSummary: "Ran command: npm test",
  });

  assert.match(text, /Agent progress:/);
  assert.match(text, /Ran command: npm test/);
});

test("formatFinal returns only the Codex answer for chat handoff completions", () => {
  const text = formatFinal({
    id: "rcmd_chat",
    mode: "thread_handoff",
    presentation: "chat",
    status: "completed",
    codexSessionId: "019e0ffb",
    result: "这是 Codex 的直接回复。",
    diffSummary: "README.md | 1 +",
  });

  assert.equal(text, "这是 Codex 的直接回复。");
});

test("formatProgress returns only readable progress content", () => {
  const text = formatProgress({ id: "rcmd_test" }, "Ran command:\nnpm test\nOutput:\n51 passed");

  assert.doesNotMatch(text, /Codex progress/);
  assert.doesNotMatch(text, /Task: rcmd_test/);
  assert.match(text, /Ran command:\nnpm test/);
  assert.match(text, /Output:\n51 passed/);
});
