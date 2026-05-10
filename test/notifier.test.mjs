import test from "node:test";
import assert from "node:assert/strict";
import { LarkNotifier } from "../src/notifier.mjs";

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
