import test from "node:test";
import assert from "node:assert/strict";
import { formatHelp, formatTask, formatWhoami } from "../src/presenter.mjs";

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
