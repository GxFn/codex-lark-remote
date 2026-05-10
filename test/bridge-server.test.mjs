import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { processLarkEvent } from "../plugins/codex-lark-remote/src/bridge-server.mjs";
import { activateHandoff } from "../plugins/codex-lark-remote/src/handoff.mjs";

test("processLarkEvent lets whoami bypass allowlist for identity discovery", async () => {
  const replies = [];
  const result = await processLarkEvent(
    {
      config: { lark: { allowedUsers: ["ou_allowed"] } },
      queue: { findByMessageId: async () => null },
      notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
    },
    textEvent({ text: "/codex whoami", userId: "ou_new_user" }),
  );

  assert.equal(result.success, true);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].messageId, "om_1");
  assert.match(replies[0].text, /senderId: ou_new_user/);
});

test("processLarkEvent still rejects non-whoami messages outside allowlist", async () => {
  const replies = [];
  const result = await processLarkEvent(
    {
      config: { lark: { allowedUsers: ["ou_allowed"] }, defaultRepo: "demo", repos: { demo: { path: "/repo" } } },
      queue: { findByMessageId: async () => null },
      notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
    },
    textEvent({ text: "/codex status", userId: "ou_new_user" }),
  );

  assert.equal(result.rejected, true);
  assert.deepEqual(replies, [{ messageId: "om_1", text: "Permission denied." }]);
});

test("processLarkEvent routes normal messages to current-thread handoff when active", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-bridge-"));
  await activateHandoff({
    dataDir,
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    cwd: "/workspace",
    activatedBy: "test",
  });
  const replies = [];
  const enqueued = [];
  let kicked = 0;

  const result = await processLarkEvent(
    {
      config: {
        dataDir,
        lark: { allowedUsers: ["ou_allowed"] },
        defaultRepo: "demo",
        repos: { demo: { path: "/repo" } },
      },
      queue: {
        findByMessageId: async () => null,
        enqueue: async (input) => {
          const command = {
            id: "rcmd_1",
            status: "pending",
            ...input,
          };
          enqueued.push(command);
          return command;
        },
      },
      notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
      runner: { processAll: () => { kicked += 1; } },
    },
    textEvent({ text: "[demo] update README from Feishu", userId: "ou_allowed" }),
  );

  assert.equal(result.success, true);
  assert.equal(kicked, 1);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].mode, "thread_handoff");
  assert.equal(enqueued[0].presentation, "chat");
  assert.equal(enqueued[0].repoKey, "current");
  assert.equal(enqueued[0].projectRoot, "/workspace");
  assert.equal(enqueued[0].prompt, "[demo] update README from Feishu");
  assert.equal(enqueued[0].codexSessionId, "019e0ffb-52e9-7ee3-bb87-42019b58eaa2");
  assert.deepEqual(replies, []);
});

test("processLarkEvent treats shell-looking text as chat input during handoff", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-bridge-"));
  await activateHandoff({
    dataDir,
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    cwd: "/workspace",
    activatedBy: "test",
  });
  const replies = [];
  const enqueued = [];

  await processLarkEvent(
    {
      config: {
        dataDir,
        lark: { allowedUsers: ["ou_allowed"] },
        defaultRepo: "demo",
        repos: { demo: { path: "/repo" } },
      },
      queue: {
        findByMessageId: async () => null,
        enqueue: async (input) => {
          enqueued.push(input);
          return { id: "rcmd_2", status: "pending", ...input };
        },
      },
      notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
      runner: { processAll: () => {} },
    },
    textEvent({ text: "$ 这不是 shell，是我要问 Codex 的内容", userId: "ou_allowed" }),
  );

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].prompt, "$ 这不是 shell，是我要问 Codex 的内容");
  assert.deepEqual(replies, []);
});

function textEvent({ text, userId }) {
  return {
    event: {
      message: {
        message_id: "om_1",
        chat_id: "oc_chat",
        message_type: "text",
        content: JSON.stringify({ text }),
      },
      sender: {
        sender_id: { user_id: userId },
      },
    },
  };
}
