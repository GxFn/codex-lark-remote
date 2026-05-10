import test from "node:test";
import assert from "node:assert/strict";
import { classifyChatText, configuredAllowedUsers, isUserAllowed, parseLarkEvent } from "../plugins/codex-lark-remote/src/lark.mjs";

test("parseLarkEvent extracts text message fields and hashes sensitive ids", () => {
  const parsed = parseLarkEvent({
    event: {
      message: {
        message_id: "om_123",
        chat_id: "oc_secret_chat",
        message_type: "text",
        content: JSON.stringify({ text: "@_user_1 [demo] fix tests" }),
      },
      sender: {
        sender_id: { user_id: "ou_secret_user", open_id: "ou_open_secret", union_id: "on_union_secret" },
      },
    },
  });

  assert.equal(parsed.kind, "message");
  assert.equal(parsed.messageId, "om_123");
  assert.equal(parsed.text, "[demo] fix tests");
  assert.equal(parsed.senderId, "ou_secret_user");
  assert.equal(parsed.senderIdType, "user_id");
  assert.equal(parsed.openId, "ou_open_secret");
  assert.equal(parsed.unionId, "on_union_secret");
  assert.match(parsed.chatIdHash, /^c_[a-f0-9]{12}$/);
  assert.match(parsed.userIdHash, /^u_[a-f0-9]{12}$/);
});

test("classifyChatText recognizes repo prefixes and management commands", () => {
  const config = { defaultRepo: "main", repos: { main: {}, demo: {} } };

  assert.deepEqual(classifyChatText("[demo] fix tests", config), {
    kind: "task",
    forced: false,
    repoKey: "demo",
    taskText: "fix tests",
  });

  assert.deepEqual(classifyChatText("/codex status rcmd_1", config), {
    kind: "task_status",
    id: "rcmd_1",
  });

  assert.deepEqual(classifyChatText("/codex whoami", config), {
    kind: "whoami",
  });

  assert.deepEqual(classifyChatText("/codex handoff", config), {
    kind: "handoff_status",
  });

  assert.deepEqual(classifyChatText("/codex handoff off", config), {
    kind: "handoff_disable",
  });
});

test("classifyChatText rejects shell mode in MVP", () => {
  const result = classifyChatText("$ rm -rf .", { defaultRepo: "main", repos: { main: {} } });
  assert.equal(result.kind, "rejected");
});

test("isUserAllowed accepts config based allowlists", () => {
  const config = { lark: { allowedUsers: ["ou_allowed"] } };

  assert.deepEqual(configuredAllowedUsers(config), ["ou_allowed"]);
  assert.equal(isUserAllowed("ou_allowed", config), true);
  assert.equal(isUserAllowed("ou_blocked", config), false);
});
