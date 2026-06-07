import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startupNoticeFilePath } from "../src/config.mjs";
import { sendStartupIntroIfNeeded, startupNoticeTarget } from "../src/startup-notice.mjs";

test("sendStartupIntroIfNeeded sends configured startup intro only once", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-startup-notice-"));
  const sent = [];
  const ctx = {
    config: {
      dataDir,
      lark: { appId: "cli_test" },
      startup: { receiveId: "oc_configured", receiveIdType: "chat_id" },
    },
    notifier: {
      send: async (receiveId, text, options) => {
        sent.push({ kind: "text", receiveId, text, options });
        return { ok: true, messageId: "om_startup_text" };
      },
      sendCard: async (receiveId, card, options) => {
        sent.push({ kind: "card", receiveId, card, options });
        return { ok: true, messageId: "om_startup_card" };
      },
    },
  };

  const first = await sendStartupIntroIfNeeded(ctx, { reason: "bridge_start" });
  const second = await sendStartupIntroIfNeeded(ctx, { reason: "bridge_start" });
  const state = JSON.parse(await fs.readFile(startupNoticeFilePath(dataDir), "utf8"));

  assert.equal(first.sent, true);
  assert.equal(second.reason, "already sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "card");
  assert.equal(sent[0].receiveId, "oc_configured");
  assert.match(JSON.stringify(sent[0].card), /Codex 已连接飞书/);
  assert.equal(Object.keys(state.notices).length, 1);
});

test("sendStartupIntroIfNeeded remembers the last allowed Feishu chat for later startup", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-startup-remember-"));
  const sent = [];
  const ctx = {
    config: {
      dataDir,
      lark: { appId: "cli_test" },
      startup: { once: false },
    },
    notifier: {
      send: async (receiveId, text, options) => {
        sent.push({ receiveId, text, options });
        return { ok: true, messageId: `om_startup_${sent.length}` };
      },
    },
  };

  await sendStartupIntroIfNeeded(ctx, {
    reason: "first_authorized_message",
    event: { chatId: "oc_remembered", chatIdHash: "c_known" },
  });
  await sendStartupIntroIfNeeded(ctx, { reason: "bridge_start" });

  const state = JSON.parse(await fs.readFile(startupNoticeFilePath(dataDir), "utf8"));
  assert.deepEqual(sent.map((item) => item.receiveId), ["oc_remembered", "oc_remembered"]);
  assert.equal(state.lastTarget.receiveId, "oc_remembered");
  assert.equal(state.lastTarget.chatIdHash, "c_known");
});

test("startupNoticeTarget falls back to the current Feishu chat id", () => {
  const previousReceiveId = process.env.CODEX_LARK_STARTUP_RECEIVE_ID;
  const previousChatId = process.env.CODEX_LARK_STARTUP_CHAT_ID;
  try {
    delete process.env.CODEX_LARK_STARTUP_RECEIVE_ID;
    delete process.env.CODEX_LARK_STARTUP_CHAT_ID;
    assert.deepEqual(
      startupNoticeTarget({}, { chatId: "oc_event" }),
      { receiveId: "oc_event", receiveIdType: "chat_id", source: "event_chat" },
    );
  } finally {
    if (previousReceiveId === undefined) delete process.env.CODEX_LARK_STARTUP_RECEIVE_ID;
    else process.env.CODEX_LARK_STARTUP_RECEIVE_ID = previousReceiveId;
    if (previousChatId === undefined) delete process.env.CODEX_LARK_STARTUP_CHAT_ID;
    else process.env.CODEX_LARK_STARTUP_CHAT_ID = previousChatId;
  }
});
