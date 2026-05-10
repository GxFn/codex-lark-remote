import test from "node:test";
import assert from "node:assert/strict";
import { classifyChatText, parseLarkEvent } from "../src/lark.mjs";

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
        sender_id: { user_id: "ou_secret_user" },
      },
    },
  });

  assert.equal(parsed.kind, "message");
  assert.equal(parsed.messageId, "om_123");
  assert.equal(parsed.text, "[demo] fix tests");
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
});

test("classifyChatText rejects shell mode in MVP", () => {
  const result = classifyChatText("$ rm -rf .", { defaultRepo: "main", repos: { main: {} } });
  assert.equal(result.kind, "rejected");
});

