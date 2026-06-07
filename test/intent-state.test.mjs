import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { intentConsoleFilePath } from "../src/config.mjs";
import {
  detectIntentLanguage,
  readIntentSession,
  resolveIntentSessionLanguage,
  resolveIntentSessionMode,
  setIntentSessionLanguage,
  setIntentSessionMode,
} from "../src/intent-state.mjs";

test("intent session state stores console and handoff modes by chat", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-intent-state-"));
  const event = { chatId: "oc_chat", chatIdHash: "c_chat", userIdHash: "u_user" };

  assert.equal(await resolveIntentSessionMode({ dataDir, event, config: {} }), "handoff");

  const consoleSession = await setIntentSessionMode({ dataDir, event, mode: "console", reason: "test" });
  assert.equal(consoleSession.mode, "console");
  assert.equal(await resolveIntentSessionMode({ dataDir, event, config: {} }), "console");

  const handoffSession = await setIntentSessionMode({ dataDir, event, mode: "handoff", reason: "test" });
  assert.equal(handoffSession.mode, "handoff");
  assert.equal((await readIntentSession({ dataDir, event, config: {} })).mode, "handoff");

  const stored = JSON.parse(await fs.readFile(intentConsoleFilePath(dataDir), "utf8"));
  assert.equal(stored.sessions.c_chat.mode, "handoff");
});

test("intent session state binds display language by chat", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-intent-language-"));
  const event = { chatId: "oc_chat", chatIdHash: "c_chat", userIdHash: "u_user" };

  assert.equal(detectIntentLanguage("看看有哪些项目"), "zh");
  assert.equal(detectIntentLanguage("project list"), "en");
  assert.equal(await resolveIntentSessionLanguage({ dataDir, event, config: {} }), "zh");

  await setIntentSessionLanguage({ dataDir, event, language: "en", reason: "test" });
  assert.equal((await readIntentSession({ dataDir, event, config: {} })).language, "en");
  assert.equal(await resolveIntentSessionLanguage({ dataDir, event, config: {} }), "en");
  assert.equal(await resolveIntentSessionLanguage({ dataDir, event: { ...event, text: "控制台" }, config: {} }), "zh");
});

test("configured console chats default to console mode until local state overrides them", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-intent-config-"));
  const event = { chatId: "oc_chat", chatIdHash: "c_chat" };
  const config = { intent: { consoleChatIds: ["oc_chat"] } };

  assert.equal(await resolveIntentSessionMode({ dataDir, event, config }), "console");

  await setIntentSessionMode({ dataDir, event, mode: "handoff", reason: "test" });
  assert.equal(await resolveIntentSessionMode({ dataDir, event, config }), "handoff");
});
