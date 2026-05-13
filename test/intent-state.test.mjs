import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { intentConsoleFilePath } from "../plugins/codex-lark-remote/src/config.mjs";
import { readIntentSession, resolveIntentSessionMode, setIntentSessionMode } from "../plugins/codex-lark-remote/src/intent-state.mjs";

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

test("configured console chats default to console mode until local state overrides them", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-intent-config-"));
  const event = { chatId: "oc_chat", chatIdHash: "c_chat" };
  const config = { intent: { consoleChatIds: ["oc_chat"] } };

  assert.equal(await resolveIntentSessionMode({ dataDir, event, config }), "console");

  await setIntentSessionMode({ dataDir, event, mode: "handoff", reason: "test" });
  assert.equal(await resolveIntentSessionMode({ dataDir, event, config }), "handoff");
});
