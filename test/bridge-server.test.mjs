import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { processLarkEvent, startBridge } from "../plugins/codex-lark-remote/src/bridge-server.mjs";
import { configFilePath, stateFilePath } from "../plugins/codex-lark-remote/src/config.mjs";
import { activateHandoff } from "../plugins/codex-lark-remote/src/handoff.mjs";
import { prepareTakeoverScope, readTakeover } from "../plugins/codex-lark-remote/src/takeover.mjs";

test("startBridge refuses to run before Feishu app credentials are configured", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-no-creds-"));

  await assert.rejects(
    startBridge({ dataDir }),
    /missing Feishu\/Lark appId and appSecret/,
  );
  await assert.rejects(fs.stat(stateFilePath(dataDir)), { code: "ENOENT" });
});

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

test("processLarkEvent deduplicates direct command replies and reports websocket status", async () => {
  const replies = [];
  const ctx = {
    config: { lark: { allowedUsers: ["ou_allowed"], transport: "websocket" } },
    queue: {
      findByMessageId: async () => null,
      counts: async () => ({}),
    },
    notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
    runner: { busy: false },
    larkWs: { status: () => ({ enabled: true, connected: true, message: "Connected via WebSocket" }) },
  };

  const first = await processLarkEvent(ctx, textEvent({ text: "/codex status", userId: "ou_allowed" }));
  const second = await processLarkEvent(ctx, textEvent({ text: "/codex status", userId: "ou_allowed" }));

  assert.equal(first.success, true);
  assert.equal(second.duplicate, true);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /Feishu\/Lark: websocket connected/);
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
  assert.equal(enqueued[0].notifyStarted, true);
  assert.equal(enqueued[0].includeRemoteNote, true);
  assert.equal(enqueued[0].codexSessionId, "019e0ffb-52e9-7ee3-bb87-42019b58eaa2");
  assert.deepEqual(replies, []);
});

test("processLarkEvent only includes the remote note on the first handoff message", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-note-once-"));
  await activateHandoff({
    dataDir,
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    cwd: "/workspace",
    activatedBy: "test",
  });
  const enqueued = [];
  const ctx = {
    config: {
      dataDir,
      lark: { allowedUsers: ["ou_allowed"] },
    },
    queue: {
      findByMessageId: async () => null,
      enqueue: async (input) => {
        const command = { id: `rcmd_${enqueued.length + 1}`, status: "pending", ...input };
        enqueued.push(command);
        return command;
      },
    },
    notifier: { reply: async () => {} },
    runner: { processAll: () => {} },
  };

  await processLarkEvent(ctx, textEvent({ text: "检查架构", userId: "ou_allowed", messageId: "om_1" }));
  await processLarkEvent(ctx, textEvent({ text: "继续分析", userId: "ou_allowed", messageId: "om_2" }));

  assert.equal(enqueued.length, 2);
  assert.equal(enqueued[0].includeRemoteNote, true);
  assert.equal(enqueued[1].includeRemoteNote, false);
});

test("processLarkEvent turns mid-run handoff messages into queued guidance", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-guidance-"));
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
      },
      queue: {
        findByMessageId: async () => null,
        list: async () => [{
          id: "rcmd_running",
          mode: "thread_handoff",
          status: "running",
          codexSessionId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
        }],
        enqueue: async (input) => {
          const command = { id: "rcmd_guidance", status: "pending", ...input };
          enqueued.push(command);
          return command;
        },
      },
      notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
      runner: { busy: true, processAll: () => {} },
    },
    textEvent({ text: "先别改 README，优先修测试", userId: "ou_allowed" }),
  );

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].handoffGuidance, true);
  assert.equal(enqueued[0].guidanceForCommandId, "rcmd_running");
  assert.match(enqueued[0].prompt, /Supplemental guidance/);
  assert.match(enqueued[0].prompt, /先别改 README，优先修测试/);
  assert.match(replies[0].text, /已收到补充引导/);
});

test("processLarkEvent disables handoff and cancels active handoff tasks", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-disable-"));
  await activateHandoff({
    dataDir,
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    cwd: "/workspace",
    activatedBy: "test",
  });
  const replies = [];
  const cancelled = [];
  const commands = [
    {
      id: "rcmd_running",
      mode: "thread_handoff",
      status: "running",
      codexSessionId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    },
    {
      id: "rcmd_other",
      mode: "thread_handoff",
      status: "running",
      codexSessionId: "other-thread",
    },
  ];

  await processLarkEvent(
    {
      config: {
        dataDir,
        lark: { allowedUsers: ["ou_allowed"] },
      },
      queue: {
        findByMessageId: async () => null,
        list: async () => commands,
        cancel: async (id, reason) => {
          cancelled.push({ id, reason });
          return { id, status: "cancelled", error: reason };
        },
      },
      notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
      keepAwake: { stop: () => ({ running: false }) },
    },
    textEvent({ text: "关闭接管", userId: "ou_allowed" }),
  );

  assert.deepEqual(cancelled, [{ id: "rcmd_running", reason: "handoff disabled by user" }]);
  assert.match(replies[0].text, /handoff: off/);
});

test("processLarkEvent lists and starts explicit read-only observation", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-observe-"));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-home-observe-"));
  const sessions = path.join(codexHome, "sessions", "2026", "05", "11");
  await fs.mkdir(sessions, { recursive: true });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-11T10-00-00-019e0000-0000-7000-8000-000000000001.jsonl"),
    id: "019e0000-0000-7000-8000-000000000001",
    cwd: "/workspace",
    name: "Target chat",
    mtime: new Date("2026-05-11T10:00:00Z"),
  });
  const originalCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  const replies = [];
  const started = [];
  const ctx = {
    config: {
      dataDir,
      lark: { allowedUsers: ["ou_allowed"] },
    },
    queue: {
      findByMessageId: async () => null,
    },
    notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
    observer: { start: async (state) => started.push(state) },
  };

  try {
    await processLarkEvent(ctx, textEvent({ text: "/codex observe", userId: "ou_allowed" }));
    await processLarkEvent(ctx, textEvent({ text: "/codex observe 1", userId: "ou_allowed", messageId: "om_2" }));
  } finally {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  }

  assert.match(replies[0].text, /Observable Codex sessions/);
  assert.match(replies[0].text, /Target chat/);
  assert.equal(started[0].threadId, "019e0000-0000-7000-8000-000000000001");
  assert.equal(started[0].messageId, "om_2");
  assert.match(replies[1].text, /observation: active/);
});

test("processLarkEvent updates command display preference", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-commands-"));
  const replies = [];
  const ctx = {
    config: {
      dataDir,
      lark: { allowedUsers: ["ou_allowed"] },
      handoff: { showCommands: false },
    },
    queue: { findByMessageId: async () => null },
    notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
  };

  await processLarkEvent(ctx, textEvent({ text: "/codex commands on", userId: "ou_allowed" }));

  assert.equal(ctx.config.handoff.showCommands, true);
  assert.match(replies[0].text, /Command display: on/);
  assert.equal(JSON.parse(await fs.readFile(configFilePath(dataDir), "utf8")).handoff.showCommands, true);
});

test("processLarkEvent lets Feishu inspect takeover windows before attaching", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-takeover-list-"));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-home-takeover-list-"));
  const sessions = path.join(codexHome, "sessions", "2026", "05", "13");
  await fs.mkdir(sessions, { recursive: true });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-00-00-019e0000-0000-7000-8000-000000000010.jsonl"),
    id: "019e0000-0000-7000-8000-000000000010",
    cwd: "/workspace",
    name: "Starter B",
    mtime: new Date("2026-05-13T10:00:00Z"),
  });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-01-00-019e0000-0000-7000-8000-000000000011.jsonl"),
    id: "019e0000-0000-7000-8000-000000000011",
    cwd: "/workspace",
    name: "Target A",
    mtime: new Date("2026-05-13T10:01:00Z"),
  });
  await prepareTakeoverScope({
    dataDir,
    codexHome,
    cwd: "/workspace",
    threadId: "019e0000-0000-7000-8000-000000000010",
  });
  const originalCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  const replies = [];
  const cards = [];
  const ctx = {
    config: {
      dataDir,
      lark: { allowedUsers: ["ou_allowed"] },
      takeover: { idleDebounceMs: 1 },
    },
    queue: { findByMessageId: async () => null },
    notifier: {
      reply: async (messageId, text) => replies.push({ messageId, text }),
      replyCard: async (messageId, card) => {
        cards.push({ messageId, card });
        return { ok: true };
      },
    },
  };

  try {
    await processLarkEvent(ctx, textEvent({ text: "/codex takeover", userId: "ou_allowed" }));
    await processLarkEvent(ctx, textEvent({ text: "1", userId: "ou_allowed", messageId: "om_2" }));
  } finally {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  }

  assert.equal(cards.length, 2);
  assert.match(JSON.stringify(cards[0].card), /Target A/);
  assert.equal((await readTakeover({ dataDir })).state, "selected");
  assert.deepEqual(replies, []);
});

test("processLarkEvent executes takeover from a card action", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-takeover-card-"));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-home-takeover-card-"));
  const sessions = path.join(codexHome, "sessions", "2026", "05", "13");
  await fs.mkdir(sessions, { recursive: true });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-01-00-019e0000-0000-7000-8000-000000000012.jsonl"),
    id: "019e0000-0000-7000-8000-000000000012",
    cwd: "/workspace",
    name: "Target A",
    events: [{ type: "turn.completed", payload: {} }],
    mtime: new Date("2026-05-13T10:01:00Z"),
  });
  await prepareTakeoverScope({ dataDir, codexHome, cwd: "/workspace" });
  const originalCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  const replies = [];
  let keepAwakeStarted = 0;
  const ctx = {
    config: {
      dataDir,
      lark: { allowedUsers: ["ou_allowed"] },
      takeover: { idleDebounceMs: 1 },
    },
    notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
    keepAwake: { start: () => { keepAwakeStarted += 1; } },
    queue: { enqueue: async (input) => ({ id: "rcmd_1", ...input }) },
    runner: { processAll: () => {} },
  };

  try {
    await processLarkEvent(ctx, cardActionEvent({
      action: "takeover_execute",
      optionIndex: 1,
      threadId: "019e0000-0000-7000-8000-000000000012",
      userId: "ou_allowed",
    }));
  } finally {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  }

  assert.equal(keepAwakeStarted, 1);
  assert.match(replies[0].text, /Takeover active/);
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

async function writeSession({ file, id, cwd, name = "", source = "vscode", events = [], mtime }) {
  const lines = [
    JSON.stringify({
      type: "session_meta",
      payload: { id, cwd, name, source },
    }),
    ...events.map((event) => JSON.stringify(event)),
  ];
  await fs.writeFile(file, `${lines.join("\n")}\n`);
  await fs.utimes(file, mtime, mtime);
}

function textEvent({ text, userId, messageId = "om_1" }) {
  return {
    event: {
      message: {
        message_id: messageId,
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

function cardActionEvent({ action, optionIndex, threadId, userId = "ou_allowed", messageId = "om_card" }) {
  return {
    header: { event_type: "card.action.trigger" },
    event: {
      action: {
        value: { action, optionIndex, threadId },
      },
      context: {
        open_message_id: messageId,
        open_chat_id: "oc_card",
      },
      operator: {
        operator_id: { user_id: userId },
      },
    },
  };
}
