import test from "node:test";
import assert from "node:assert/strict";
import { LarkNotifier, splitForLarkText } from "../plugins/codex-lark-remote/src/notifier.mjs";

test("LarkNotifier.checkAuth reports missing credentials without throwing", async () => {
  const notifier = new LarkNotifier({ appId: "", appSecret: "" });
  const result = await notifier.checkAuth();
  assert.equal(result.ok, false);
  assert.equal(result.hasCredentials, false);
});

test("LarkNotifier.reply treats Feishu business errors as failed delivery", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    if (String(url).includes("/auth/v3/tenant_access_token/internal")) {
      return Response.json({ code: 0, tenant_access_token: "token", expire: 3600 });
    }
    return Response.json({ code: 230001, msg: "message not found" });
  };

  const notifier = new LarkNotifier({ appId: "cli_test", appSecret: "secret" });
  const result = await notifier.reply("om_test", "hello");

  assert.equal(result.ok, false);
  assert.equal(result.code, 230001);
  assert.match(result.error, /message not found/);
});

test("LarkNotifier.reply returns delivered message id when Feishu accepts the reply", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    if (String(url).includes("/auth/v3/tenant_access_token/internal")) {
      return Response.json({ code: 0, tenant_access_token: "token", expire: 3600 });
    }
    return Response.json({ code: 0, data: { message_id: "om_reply" } });
  };

  const notifier = new LarkNotifier({ appId: "cli_test", appSecret: "secret" });
  const result = await notifier.reply("om_test", "hello");

  assert.equal(result.ok, true);
  assert.equal(result.messageId, "om_reply");
});

test("LarkNotifier.replyCard sends interactive message content", async (t) => {
  const originalFetch = globalThis.fetch;
  const sent = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/auth/v3/tenant_access_token/internal")) {
      return Response.json({ code: 0, tenant_access_token: "token", expire: 3600 });
    }
    sent.push(JSON.parse(init.body));
    return Response.json({ code: 0, data: { message_id: "om_card_reply" } });
  };

  const notifier = new LarkNotifier({ appId: "cli_test", appSecret: "secret" });
  const result = await notifier.replyCard("om_test", { elements: [{ tag: "markdown", content: "hello" }] });

  assert.equal(result.ok, true);
  assert.equal(sent[0].msg_type, "interactive");
  assert.deepEqual(JSON.parse(sent[0].content), { elements: [{ tag: "markdown", content: "hello" }] });
});

test("LarkNotifier.patchCard updates interactive message content", async (t) => {
  const originalFetch = globalThis.fetch;
  let patchRequest = null;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("/auth/v3/tenant_access_token/internal")) {
      return Response.json({ code: 0, tenant_access_token: "token", expire: 3600 });
    }
    patchRequest = { url: String(url), method: init.method, body: JSON.parse(init.body) };
    return Response.json({ code: 0, data: {} });
  };

  const notifier = new LarkNotifier({ appId: "cli_test", appSecret: "secret" });
  const result = await notifier.patchCard("om_card", { config: { update_multi: true } });

  assert.equal(result.ok, true);
  assert.equal(patchRequest.method, "PATCH");
  assert.match(patchRequest.url, /\/im\/v1\/messages\/om_card$/);
  assert.equal(patchRequest.body.msg_type, "interactive");
});

test("LarkNotifier.reply splits long text replies without truncating content", async (t) => {
  const originalFetch = globalThis.fetch;
  const sentTexts = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/auth/v3/tenant_access_token/internal")) {
      return Response.json({ code: 0, tenant_access_token: "token", expire: 3600 });
    }
    const body = JSON.parse(init.body);
    sentTexts.push(JSON.parse(body.content).text);
    return Response.json({ code: 0, data: { message_id: `om_reply_${sentTexts.length}` } });
  };

  const longText = ["first line", "x".repeat(2900), "last line"].join("\n");
  const notifier = new LarkNotifier({ appId: "cli_test", appSecret: "secret" });
  const result = await notifier.reply("om_test", longText);

  assert.equal(result.ok, true);
  assert.equal(result.totalParts, sentTexts.length);
  assert.ok(sentTexts.length > 1);
  assert.equal(sentTexts.join(""), longText);
  assert.equal(result.messageId, "om_reply_1");
});

test("splitForLarkText prefers newline boundaries", () => {
  assert.deepEqual(splitForLarkText("a\nb\nc", 4), ["a\nb\n", "c"]);
});
