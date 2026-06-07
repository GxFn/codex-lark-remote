import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { processLarkEvent, startBridge } from "../src/bridge-server.mjs";
import { configFilePath, stateFilePath } from "../src/config.mjs";
import { activateHandoff, readHandoff } from "../src/handoff.mjs";
import { readIntentSession } from "../src/intent-state.mjs";
import { prepareTakeoverScope, readTakeover } from "../src/takeover.mjs";

test("startBridge refuses to run before Feishu app credentials are configured", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-no-creds-"));

  await assert.rejects(
    startBridge({ dataDir }),
    /Codex Lark Remote setup required[\s\S]*clipboard[\s\S]*已复制[\s\S]*card\.action\.trigger[\s\S]*allowedUsers: \[\]/,
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

test("processLarkEvent sends startup intro to the first allowed Feishu chat once", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-startup-"));
  const previousReceiveId = process.env.CODEX_LARK_STARTUP_RECEIVE_ID;
  const previousChatId = process.env.CODEX_LARK_STARTUP_CHAT_ID;
  const replies = [];
  const sent = [];
  const ctx = {
    config: {
      dataDir,
      lark: { appId: "cli_test", allowedUsers: ["ou_allowed"], transport: "websocket" },
    },
    queue: {
      findByMessageId: async () => null,
      counts: async () => ({}),
    },
    notifier: {
      reply: async (messageId, text) => replies.push({ messageId, text }),
      send: async (receiveId, text, options) => {
        sent.push({ receiveId, text, options });
        return { ok: true, messageId: "om_startup" };
      },
    },
    runner: { busy: false },
    larkWs: { status: () => ({ enabled: true, connected: true }) },
  };

  try {
    delete process.env.CODEX_LARK_STARTUP_RECEIVE_ID;
    delete process.env.CODEX_LARK_STARTUP_CHAT_ID;
    await processLarkEvent(ctx, textEvent({ text: "/codex status", userId: "ou_allowed", messageId: "om_1" }));
    await processLarkEvent(ctx, textEvent({ text: "/codex status", userId: "ou_allowed", messageId: "om_2" }));

    assert.equal(sent.length, 1);
    assert.equal(sent[0].receiveId, "oc_chat");
    assert.equal(sent[0].options.receiveIdType, "chat_id");
    assert.match(sent[0].text, /Codex is connected to Lark/);
    assert.equal(replies.length, 2);
  } finally {
    if (previousReceiveId === undefined) delete process.env.CODEX_LARK_STARTUP_RECEIVE_ID;
    else process.env.CODEX_LARK_STARTUP_RECEIVE_ID = previousReceiveId;
    if (previousChatId === undefined) delete process.env.CODEX_LARK_STARTUP_CHAT_ID;
    else process.env.CODEX_LARK_STARTUP_CHAT_ID = previousChatId;
  }
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

test("processLarkEvent discards handoff messages when the selected desktop session is busy", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-desktop-busy-"));
  const sessionFile = path.join(dataDir, "rollout-2026-05-13T10-01-00-019e0ffb-52e9-7ee3-bb87-42019b58eaa2.jsonl");
  await writeSession({
    file: sessionFile,
    id: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    cwd: "/workspace",
    name: "Busy desktop session",
    events: [{ type: "event_msg", payload: { type: "agent_reasoning", message: "desktop is working" } }],
    mtime: new Date(),
  });
  await activateHandoff({
    dataDir,
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    threadPath: sessionFile,
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
        takeover: { idleDebounceMs: 60_000 },
      },
      queue: {
        findByMessageId: async () => null,
        list: async () => [],
        enqueue: async (input) => {
          enqueued.push(input);
          return { id: "rcmd_busy", status: "pending", ...input };
        },
      },
      notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
      runner: { busy: false, processAll: () => { kicked += 1; } },
    },
    textEvent({ text: "继续这个任务", userId: "ou_allowed" }),
  );

  assert.equal(result.success, true);
  assert.equal(kicked, 0);
  assert.equal(enqueued.length, 0);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /正在 Codex Desktop 中执行/);
  assert.match(replies[0].text, /没有发送，也不会排队/);
});

test("processLarkEvent enables console mode and routes unknown text through intent translator", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-intent-console-"));
  const replies = [];
  const cards = [];
  let translated = 0;
  const ctx = {
    config: {
      dataDir,
      lark: { allowedUsers: ["ou_allowed"], transport: "websocket" },
      intent: { mode: "hybrid", translator: { minConfidence: 0.75 } },
      handoff: { showCommands: false },
    },
    queue: {
      findByMessageId: async () => null,
      counts: async () => ({}),
    },
    notifier: {
      reply: async (messageId, text) => replies.push({ messageId, text }),
      replyCard: async (messageId, card) => {
        cards.push({ messageId, card });
        return { ok: true };
      },
    },
    runner: { busy: false },
    keepAwake: { status: () => ({ enabled: false }) },
    larkWs: { status: () => ({ enabled: true, connected: true }) },
    intentTranslator: async () => {
      translated += 1;
      return { intent: "system.status", args: {}, confidence: 0.95 };
    },
  };

  await processLarkEvent(ctx, textEvent({ text: "控制台", userId: "ou_allowed", messageId: "om_console" }));
  await processLarkEvent(ctx, textEvent({ text: "看看桥现在怎么样", userId: "ou_allowed", messageId: "om_status" }));

  const stored = await readIntentSession({ dataDir, event: { chatId: "oc_chat" }, config: ctx.config });
  assert.equal(stored.mode, "console");
  assert.equal(translated, 1);
  assert.equal(cards.length, 2);
  assert.match(JSON.stringify(cards[0].card), /自然语言控制台/);
  assert.match(JSON.stringify(cards[1].card), /Lark Remote 状态/);
  assert.deepEqual(replies, []);
});

test("processLarkEvent does not send a duplicate startup intro when opening console first", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-console-no-startup-"));
  const cards = [];
  const sent = [];
  const ctx = {
    config: {
      dataDir,
      lark: { appId: "cli_test", allowedUsers: ["ou_allowed"], transport: "websocket" },
    },
    queue: { findByMessageId: async () => null },
    notifier: {
      send: async (receiveId, text, options) => {
        sent.push({ receiveId, text, options });
        return { ok: true };
      },
      sendCard: async (receiveId, card, options) => {
        sent.push({ receiveId, card, options });
        return { ok: true };
      },
      replyCard: async (messageId, card) => {
        cards.push({ messageId, card });
        return { ok: true };
      },
      reply: async () => {},
    },
  };

  await processLarkEvent(ctx, textEvent({ text: "控制台", userId: "ou_allowed", messageId: "om_console" }));
  await processLarkEvent(ctx, textEvent({ text: "项目列表", userId: "ou_allowed", messageId: "om_projects" }));

  assert.equal(sent.length, 0);
  assert.equal(cards.length, 2);
  assert.match(JSON.stringify(cards[0].card), /自然语言控制台/);
});

test("processLarkEvent binds console card language from English input", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-console-en-"));
  const cards = [];
  const ctx = {
    config: {
      dataDir,
      lark: { allowedUsers: ["ou_allowed"], transport: "websocket" },
    },
    queue: { findByMessageId: async () => null },
    notifier: {
      replyCard: async (messageId, card) => {
        cards.push({ messageId, card });
        return { ok: true };
      },
      reply: async () => {},
    },
  };

  await processLarkEvent(ctx, textEvent({ text: "console", userId: "ou_allowed", messageId: "om_console" }));

  const rendered = JSON.stringify(cards[0].card);
  assert.match(rendered, /Natural-Language Console/);
  assert.match(rendered, /Close Connection/);
  assert.doesNotMatch(rendered, /自然语言控制台|关闭连接/);
  assert.equal((await readIntentSession({ dataDir, event: { chatId: "oc_chat" }, config: ctx.config })).language, "en");
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
  assert.match(replies[0].text, /已退出当前接管/);
  assert.match(replies[0].text, /飞书连接仍然保持/);
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
    await processLarkEvent(ctx, textEvent({ text: "1", userId: "ou_allowed", messageId: "om_3" }));
  } finally {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  }

  assert.equal(cards.length, 3);
  assert.match(JSON.stringify(cards[0].card), /Takeover-Ready Projects/);
  assert.match(JSON.stringify(cards[1].card), /Target A/);
  assert.equal((await readTakeover({ dataDir })).state, "selected");
  assert.deepEqual(replies, []);
});

test("processLarkEvent lists projects first, then scopes windows to the chosen project", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-takeover-handoff-scope-"));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-home-takeover-handoff-scope-"));
  const sessions = path.join(codexHome, "sessions", "2026", "05", "13");
  await fs.mkdir(sessions, { recursive: true });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-00-00-019e0000-0000-7000-8000-000000000020.jsonl"),
    id: "019e0000-0000-7000-8000-000000000020",
    cwd: "/workspace/project",
    name: "Current handoff",
    mtime: new Date("2026-05-13T10:00:00Z"),
  });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-01-00-019e0000-0000-7000-8000-000000000021.jsonl"),
    id: "019e0000-0000-7000-8000-000000000021",
    cwd: "/workspace/project",
    name: "Target in project",
    mtime: new Date("2026-05-13T10:03:00Z"),
  });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-02-00-019e0000-0000-7000-8000-000000000022.jsonl"),
    id: "019e0000-0000-7000-8000-000000000022",
    cwd: "/workspace/other",
    name: "Other project",
    mtime: new Date("2026-05-13T10:02:00Z"),
  });
  await activateHandoff({
    dataDir,
    threadId: "019e0000-0000-7000-8000-000000000020",
    cwd: "/workspace/project",
    activatedBy: "test",
  });

  const originalCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  const cards = [];
  const ctx = {
    config: {
      dataDir,
      lark: { allowedUsers: ["ou_allowed"] },
      takeover: { idleDebounceMs: 1 },
    },
    queue: { findByMessageId: async () => null },
    notifier: {
      reply: async () => {},
      replyCard: async (messageId, card) => {
        cards.push({ messageId, card });
        return { ok: true };
      },
    },
  };

  try {
    await processLarkEvent(ctx, textEvent({ text: "/codex windows", userId: "ou_allowed" }));
    await processLarkEvent(ctx, textEvent({ text: "/codex takeover 1", userId: "ou_allowed", messageId: "om_2" }));
  } finally {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  }

  assert.equal(cards.length, 2);
  const projects = JSON.stringify(cards[0].card);
  assert.match(projects, /\/workspace\/project/);
  assert.match(projects, /\/workspace\/other/);
  const windows = JSON.stringify(cards[1].card);
  assert.match(windows, /Current handoff/);
  assert.match(windows, /Target in project/);
  assert.doesNotMatch(windows, /Other project/);
});

test("processLarkEvent status reports active takeover selection", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-status-takeover-"));
  await prepareTakeoverScope({ dataDir, cwd: "/workspace/project" });
  const replies = [];

  await processLarkEvent(
    {
      config: {
        dataDir,
        lark: { allowedUsers: ["ou_allowed"] },
        handoff: { showCommands: false },
      },
      queue: {
        findByMessageId: async () => null,
        counts: async () => ({}),
      },
      runner: { busy: false },
      keepAwake: { status: () => ({ enabled: false }) },
      larkWs: { status: () => ({ enabled: true, connected: true }) },
      notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
    },
    textEvent({ text: "/codex status", userId: "ou_allowed" }),
  );

  assert.match(replies[0].text, /Takeover: selecting/);
});

test("processLarkEvent requires allowedUsers before full-project takeover", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-takeover-allowlist-"));
  const replies = [];
  const cards = [];

  await processLarkEvent(
    {
      config: {
        dataDir,
        lark: { allowedUsers: [] },
      },
      queue: { findByMessageId: async () => null },
      notifier: {
        reply: async (messageId, text) => replies.push({ messageId, text }),
        replyCard: async (messageId, card) => {
          cards.push({ messageId, card });
          return { ok: true };
        },
      },
    },
    textEvent({ text: "/codex windows", userId: "ou_allowed" }),
  );

  assert.equal(cards.length, 0);
  assert.match(replies[0].text, /lark\.allowedUsers/);
});

test("processLarkEvent reloads allowedUsers written after bridge startup", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-takeover-reload-"));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-home-takeover-reload-"));
  await fs.writeFile(
    configFilePath(dataDir),
    `${JSON.stringify({ lark: { allowedUsers: ["ou_allowed"] } }, null, 2)}\n`,
  );
  const originalCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  const replies = [];
  const cards = [];

  try {
    await processLarkEvent(
      {
        config: {
          dataDir,
          lark: { allowedUsers: [] },
        },
        queue: { findByMessageId: async () => null },
        notifier: {
          reply: async (messageId, text) => replies.push({ messageId, text }),
          replyCard: async (messageId, card) => {
            cards.push({ messageId, card });
            return { ok: true };
          },
        },
      },
      textEvent({ text: "/codex windows", userId: "ou_allowed" }),
    );
  } finally {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  }

  assert.equal(replies.find((reply) => /lark\.allowedUsers/.test(reply.text)), undefined);
  assert.equal(cards.length, 1);
  assert.match(JSON.stringify(cards[0].card), /可接管项目|Takeover-Ready Projects/);
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
    events: [
      { type: "event_msg", payload: { type: "agent_message", phase: "final_answer", message: "上轮已经完成插件状态卡片优化。" } },
      { type: "turn.completed", payload: {} },
    ],
    mtime: new Date("2026-05-13T10:01:00Z"),
  });
  await prepareTakeoverScope({ dataDir, codexHome, cwd: "/workspace" });
  const originalCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  const replies = [];
  let keepAwakeStarted = 0;
  const temporaryObservations = [];
  const ctx = {
    config: {
      dataDir,
      lark: { allowedUsers: ["ou_allowed"] },
      takeover: { idleDebounceMs: 1 },
    },
    notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
    observer: { startTemporary: async (state) => temporaryObservations.push(state) },
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
  assert.equal(temporaryObservations.length, 0);
  assert.match(replies[0].text, /接管已生效/);
  assert.match(replies[0].text, /上个任务同步/);
  assert.match(replies[0].text, /上轮已经完成插件状态卡片优化/);
  assert.equal((await readIntentSession({ dataDir, event: { chatId: "oc_card" }, config: ctx.config })).mode, "handoff");
});

test("processLarkEvent routes startup card buttons to normal actions", async () => {
  const replies = [];
  await processLarkEvent(
    {
      config: {
        lark: { allowedUsers: ["ou_allowed"], transport: "websocket" },
        handoff: { showCommands: false },
      },
      queue: { counts: async () => ({}) },
      runner: { busy: false },
      keepAwake: { status: () => ({ enabled: false }) },
      larkWs: { status: () => ({ enabled: true, connected: true }) },
      notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
    },
    cardActionEvent({ action: "startup_status", userId: "ou_allowed" }),
  );

  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /Codex Lark Remote status/);
});

test("processLarkEvent returns setup verification card on demand", async () => {
  const cards = [];
  await processLarkEvent(
    {
      config: {
        lark: {
          appId: "cli_test",
          appSecret: "secret",
          allowedUsers: ["ou_allowed"],
          transport: "websocket",
        },
      },
      queue: { findByMessageId: async () => null },
      runner: { busy: false },
      larkWs: {
        status: () => ({
          enabled: true,
          connected: true,
          message: "Connected via WebSocket",
          lastMessageEventAt: "2026-05-13T12:00:00Z",
          lastCardActionAt: "2026-05-13T12:01:00Z",
        }),
      },
      notifier: {
        checkAuth: async () => ({ ok: true, hasCredentials: true, appIdPrefix: "cli_test...", message: "Tenant access token acquired" }),
        replyCard: async (messageId, card) => {
          cards.push({ messageId, card });
          return { ok: true };
        },
        reply: async () => {},
      },
    },
    cardActionEvent({ action: "setup_verify", userId: "ou_allowed" }),
  );

  assert.equal(cards.length, 1);
  const rendered = JSON.stringify(cards[0].card);
  assert.match(rendered, /飞书配置验证/);
  assert.match(rendered, /im\.message\.receive_v1/);
  assert.match(rendered, /card\.action\.trigger/);
  assert.match(rendered, /刷新验证/);
});

test("processLarkEvent shows console card from startup card", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-startup-console-"));
  const replies = [];
  const cards = [];

  await processLarkEvent(
    {
      config: {
        dataDir,
        lark: { allowedUsers: ["ou_allowed"] },
      },
      notifier: {
        reply: async (messageId, text) => replies.push({ messageId, text }),
        replyCard: async (messageId, card) => {
          cards.push({ messageId, card });
          return { ok: true };
        },
      },
      queue: { findByMessageId: async () => null },
    },
    cardActionEvent({ action: "startup_console", userId: "ou_allowed" }),
  );

  assert.deepEqual(replies, []);
  assert.equal(cards.length, 1);
  assert.match(JSON.stringify(cards[0].card), /自然语言控制台/);
  assert.match(JSON.stringify(cards[0].card), /关闭连接/);
  assert.match(JSON.stringify(cards[0].card), /bridge_stop_prompt/);
  assert.equal((await readIntentSession({ dataDir, event: { chatId: "oc_card" }, config: {} })).mode, "console");
});

test("processLarkEvent opens bridge stop confirmation from console card", async () => {
  const replies = [];
  const cards = [];

  await processLarkEvent(
    {
      config: {
        lark: { allowedUsers: ["ou_allowed"] },
      },
      notifier: {
        reply: async (messageId, text) => replies.push({ messageId, text }),
        replyCard: async (messageId, card) => {
          cards.push({ messageId, card });
          return { ok: true };
        },
      },
      queue: { findByMessageId: async () => null },
    },
    cardActionEvent({ action: "bridge_stop_prompt", userId: "ou_allowed" }),
  );

  assert.deepEqual(replies, []);
  assert.equal(cards.length, 1);
  assert.match(JSON.stringify(cards[0].card), /确认关闭飞书连接/);
  assert.match(JSON.stringify(cards[0].card), /bridge_stop_execute/);
});

test("processLarkEvent refuses direct task mode when no session is taken over", async () => {
  const replies = [];
  await processLarkEvent(
    {
      config: {
        dataDir: await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-no-handoff-mode-")),
        lark: { allowedUsers: ["ou_allowed"] },
      },
      queue: { findByMessageId: async () => null },
      notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
    },
    textEvent({ text: "继续接管", userId: "ou_allowed" }),
  );

  assert.match(replies[0].text, /当前没有正在接管/);
});

test("processLarkEvent confirms before stopping the Feishu bridge", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-stop-bridge-"));
  const replies = [];
  const cards = [];
  const stops = [];
  const ctx = {
    config: {
      dataDir,
      lark: { allowedUsers: ["ou_allowed"] },
    },
    queue: {
      findByMessageId: async () => null,
    },
    notifier: {
      reply: async (messageId, text) => replies.push({ messageId, text }),
      replyCard: async (messageId, card) => {
        cards.push({ messageId, card });
        return { ok: true };
      },
    },
    observer: { stop: () => {} },
    keepAwake: { stop: () => {} },
    stopBridge: (reason) => stops.push(reason),
  };

  await processLarkEvent(ctx, textEvent({ text: "关闭飞书连接", userId: "ou_allowed", messageId: "om_stop_prompt" }));
  assert.equal(stops.length, 0);
  assert.equal(cards.length, 1);
  assert.match(JSON.stringify(cards[0].card), /确认关闭飞书连接/);
  assert.match(JSON.stringify(cards[0].card), /bridge_stop_execute/);

  await processLarkEvent(ctx, cardActionEvent({ action: "bridge_stop_cancel", userId: "ou_allowed", messageId: "om_stop_cancel" }));
  assert.equal(stops.length, 0);
  assert.match(replies.at(-1).text, /已取消关闭连接/);

  await processLarkEvent(ctx, cardActionEvent({ action: "bridge_stop_execute", userId: "ou_allowed", messageId: "om_stop_confirm" }));
  assert.deepEqual(stops, ["lark"]);
  assert.match(replies.at(-1).text, /正在关闭飞书连接/);
});

test("processLarkEvent discards normal messages while takeover waits for a busy target", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-pending-before-handoff-"));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-home-pending-before-handoff-"));
  const sessions = path.join(codexHome, "sessions", "2026", "05", "13");
  await fs.mkdir(sessions, { recursive: true });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-01-00-019e0000-0000-7000-8000-000000000030.jsonl"),
    id: "019e0000-0000-7000-8000-000000000030",
    cwd: "/workspace",
    name: "Running new target",
    events: [{ type: "event_msg", payload: { type: "agent_reasoning", message: "working" } }],
    mtime: new Date(),
  });
  await activateHandoff({
    dataDir,
    threadId: "019e0000-0000-7000-8000-000000000031",
    cwd: "/workspace",
    activatedBy: "test",
  });
  await prepareTakeoverScope({ dataDir, codexHome, cwd: "/workspace" });
  const originalCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  const replies = [];
  const enqueued = [];
  const temporaryObservations = [];
  const ctx = {
    config: {
      dataDir,
      lark: { allowedUsers: ["ou_allowed"] },
      takeover: { idleDebounceMs: 60_000 },
    },
    queue: {
      findByMessageId: async () => null,
      enqueue: async (input) => {
        enqueued.push(input);
        return { id: "rcmd_old", status: "pending", ...input };
      },
    },
    notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
    observer: { startTemporary: async (state) => temporaryObservations.push(state) },
    runner: { processAll: () => {} },
  };

  try {
    await processLarkEvent(ctx, cardActionEvent({
      action: "takeover_execute",
      threadId: "019e0000-0000-7000-8000-000000000030",
      userId: "ou_allowed",
    }));
    await processLarkEvent(ctx, textEvent({
      text: "这是给新目标的 pending 输入",
      userId: "ou_allowed",
      messageId: "om_pending_input",
    }));
  } finally {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  }

  const takeover = await readTakeover({ dataDir });
  assert.equal(takeover.state, "pending");
  assert.equal(temporaryObservations.length, 1);
  assert.equal(temporaryObservations[0].threadId, "019e0000-0000-7000-8000-000000000030");
  assert.equal(temporaryObservations[0].mode, "takeover_pending_observe");
  assert.deepEqual(takeover.pendingInputs, []);
  assert.equal(enqueued.length, 0);
  assert.match(replies.at(-1).text, /没有发送，也不会暂存/);
});

test("processLarkEvent cancels pending takeover without exiting the old handoff", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-pending-cancel-"));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-home-pending-cancel-"));
  const sessions = path.join(codexHome, "sessions", "2026", "05", "13");
  await fs.mkdir(sessions, { recursive: true });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-01-00-019e0000-0000-7000-8000-000000000040.jsonl"),
    id: "019e0000-0000-7000-8000-000000000040",
    cwd: "/workspace",
    name: "Running new target",
    events: [{ type: "event_msg", payload: { type: "agent_reasoning", message: "working" } }],
    mtime: new Date(),
  });
  await activateHandoff({
    dataDir,
    threadId: "019e0000-0000-7000-8000-000000000041",
    cwd: "/workspace",
    activatedBy: "test",
  });
  await prepareTakeoverScope({ dataDir, codexHome, cwd: "/workspace" });
  const originalCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  const replies = [];
  const enqueued = [];
  const temporaryStops = [];
  const ctx = {
    config: {
      dataDir,
      lark: { allowedUsers: ["ou_allowed"] },
      takeover: { idleDebounceMs: 60_000 },
    },
    queue: {
      findByMessageId: async () => null,
      enqueue: async (input) => {
        enqueued.push(input);
        return { id: "rcmd_old", status: "pending", ...input };
      },
    },
    notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
    observer: {
      startTemporary: async () => {},
      stopTemporary: async (match) => temporaryStops.push(match),
    },
    runner: { processAll: () => {} },
  };

  try {
    await processLarkEvent(ctx, cardActionEvent({
      action: "takeover_execute",
      threadId: "019e0000-0000-7000-8000-000000000040",
      userId: "ou_allowed",
    }));
    await processLarkEvent(ctx, textEvent({ text: "取消", userId: "ou_allowed", messageId: "om_cancel_pending" }));
  } finally {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  }

  assert.equal(await readTakeover({ dataDir }), null);
  assert.equal((await readHandoff({ dataDir })).threadId, "019e0000-0000-7000-8000-000000000041");
  assert.equal(enqueued.length, 0);
  assert.equal(temporaryStops.length, 1);
  assert.match(replies.at(-1).text, /已取消当前接管选择\/等待/);
  assert.match(replies.at(-1).text, /原来的接管会话/);
});

test("processLarkEvent treats takeover off as exiting an active takeover", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-active-takeover-off-"));
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-home-active-takeover-off-"));
  const sessions = path.join(codexHome, "sessions", "2026", "05", "13");
  await fs.mkdir(sessions, { recursive: true });
  await writeSession({
    file: path.join(sessions, "rollout-2026-05-13T10-01-00-019e0000-0000-7000-8000-000000000050.jsonl"),
    id: "019e0000-0000-7000-8000-000000000050",
    cwd: "/workspace",
    name: "Idle target",
    events: [{ type: "turn.completed", payload: {} }],
    mtime: new Date("2026-05-13T10:01:00Z"),
  });
  await prepareTakeoverScope({ dataDir, codexHome, cwd: "/workspace" });
  const originalCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  const replies = [];
  let keepAwakeStopped = 0;
  const ctx = {
    config: {
      dataDir,
      lark: { allowedUsers: ["ou_allowed"] },
      takeover: { idleDebounceMs: 1 },
    },
    queue: {
      findByMessageId: async () => null,
      enqueue: async (input) => ({ id: "rcmd_1", status: "pending", ...input }),
      list: async () => [],
      cancel: async () => null,
    },
    notifier: {
      reply: async (messageId, text) => replies.push({ messageId, text }),
      replyCard: async () => ({ ok: false }),
    },
    observer: { stopTemporary: async () => {} },
    keepAwake: {
      start: () => {},
      stop: () => { keepAwakeStopped += 1; },
    },
    runner: { processAll: () => {} },
  };

  try {
    await processLarkEvent(ctx, cardActionEvent({
      action: "takeover_execute",
      threadId: "019e0000-0000-7000-8000-000000000050",
      userId: "ou_allowed",
      messageId: "om_takeover",
    }));
    assert.equal((await readTakeover({ dataDir })).state, "active");
    await processLarkEvent(ctx, textEvent({ text: "/codex takeover off", userId: "ou_allowed", messageId: "om_takeover_off" }));
  } finally {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  }

  assert.equal(await readTakeover({ dataDir }), null);
  assert.equal(await readHandoff({ dataDir }), null);
  assert.equal(keepAwakeStopped, 1);
  assert.match(replies.at(-1).text, /Current takeover ended|接管已结束/);
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

test("processLarkEvent keeps natural control-looking text as task input during handoff", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-handoff-direct-"));
  await activateHandoff({
    dataDir,
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    cwd: "/workspace",
    activatedBy: "test",
  });
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
          return { id: "rcmd_3", status: "pending", ...input };
        },
      },
      notifier: { reply: async () => {} },
      runner: { processAll: () => {} },
    },
    textEvent({ text: "窗口列表", userId: "ou_allowed" }),
  );

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].mode, "thread_handoff");
  assert.equal(enqueued[0].prompt, "窗口列表");
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

function cardActionEvent({ action, optionIndex, projectIndex, cwd, threadId, userId = "ou_allowed", messageId = "om_card" }) {
  return {
    header: { event_type: "card.action.trigger" },
    event: {
      action: {
        value: { action, optionIndex, projectIndex, cwd, threadId },
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
