import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { observationFilePath, takeoverFilePath } from "../src/config.mjs";
import { CodexSessionObserver } from "../src/observer.mjs";

test("CodexSessionObserver forwards observed progress without per-message title", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-observer-"));
  const sessionPath = path.join(dataDir, "session.jsonl");
  await fs.writeFile(sessionPath, "");

  const state = {
    active: true,
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    threadPath: sessionPath,
    cwd: "/workspace",
    name: "Codex short title",
    messageId: "om_observe",
  };
  await fs.writeFile(observationFilePath(dataDir), `${JSON.stringify(state, null, 2)}\n`);

  const replies = [];
  const observer = new CodexSessionObserver({
    config: { dataDir },
    notifier: {
      reply: async (messageId, text) => replies.push({ messageId, text }),
    },
    logger: { warn: () => {} },
  });

  await observer.start(state);
  await fs.appendFile(
    sessionPath,
    [
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "请检查观察输出" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "agent_message", phase: "commentary", message: "正在检查输出逻辑。" } }),
      "",
    ].join("\n"),
  );
  await waitFor(() => replies.length >= 1);
  await observer.stop();

  assert.deepEqual(replies, [
    { messageId: "om_observe", text: "正在检查输出逻辑。" },
  ]);
  assert.doesNotMatch(replies.map((reply) => reply.text).join("\n"), /Title:|标题:/);
});

test("CodexSessionObserver forwards Mac-local prompts during active takeover", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-active-observer-"));
  const threadId = "019e0ffb-52e9-7ee3-bb87-42019b58eaa2";
  const sessionPath = path.join(dataDir, "session.jsonl");
  await fs.writeFile(sessionPath, "");
  await fs.writeFile(
    takeoverFilePath(dataDir),
    `${JSON.stringify({
      version: 1,
      state: "active",
      mode: "dispatch",
      target: { threadId, threadPath: sessionPath, cwd: "/workspace", name: "Target" },
      lark: { messageId: "om_takeover" },
    }, null, 2)}\n`,
  );

  const replies = [];
  const observer = new CodexSessionObserver({
    config: { dataDir },
    notifier: {
      reply: async (messageId, text) => replies.push({ messageId, text }),
    },
    logger: { warn: () => {} },
  });

  await observer.startTemporary({
    active: true,
    mode: "takeover_active_observe",
    threadId,
    threadPath: sessionPath,
    cwd: "/workspace",
    name: "Target",
    messageId: "om_takeover",
  });
  await fs.appendFile(
    sessionPath,
    [
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "[Lark Remote dispatch]\n来自飞书的派发" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Mac 端继续输入" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "agent_message", phase: "commentary", message: "正在处理 Mac 输入。" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "agent_message", phase: "final_answer", message: "Mac 输入处理完成。" } }),
      "",
    ].join("\n"),
  );
  await waitFor(() => replies.length >= 2);
  await observer.stop();

  assert.deepEqual(replies, [
    { messageId: "om_takeover", text: "正在处理 Mac 输入。" },
    { messageId: "om_takeover", text: "Mac 输入处理完成。" },
  ]);
});

test("CodexSessionObserver restores active takeover streaming for later Mac tasks", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-active-observer-restore-"));
  const threadId = "019e0ffb-52e9-7ee3-bb87-42019b58eaa3";
  const sessionPath = path.join(dataDir, "session.jsonl");
  await fs.writeFile(
    sessionPath,
    `${JSON.stringify({ type: "event_msg", payload: { type: "agent_message", phase: "final_answer", message: "接管前旧回复。" } })}\n`,
  );
  await fs.writeFile(
    takeoverFilePath(dataDir),
    `${JSON.stringify({
      version: 1,
      state: "active",
      mode: "dispatch",
      target: { threadId, threadPath: sessionPath, cwd: "/workspace", name: "Target" },
      lark: { messageId: "om_takeover_restore", chatIdHash: "chat_hash", userIdHash: "user_hash" },
    }, null, 2)}\n`,
  );

  const replies = [];
  const observer = new CodexSessionObserver({
    config: { dataDir },
    notifier: {
      reply: async (messageId, text) => replies.push({ messageId, text }),
    },
    logger: { warn: () => {} },
  });

  await observer.restore();
  assert.equal(observer.status().temporaryActive, true);
  assert.equal(observer.status().temporaryThreadId, threadId);

  await fs.appendFile(
    sessionPath,
    [
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Mac 端新任务" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "agent_message", phase: "commentary", message: "正在处理新任务。" } }),
      "",
    ].join("\n"),
  );
  await waitFor(() => replies.length >= 1);
  await observer.stop();

  assert.deepEqual(replies, [
    { messageId: "om_takeover_restore", text: "正在处理新任务。" },
  ]);
});

async function waitFor(predicate, timeoutMs = 1500) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for observer reply.");
    await delay(25);
  }
}
