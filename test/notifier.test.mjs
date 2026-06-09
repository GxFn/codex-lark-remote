import test from "node:test";
import assert from "node:assert/strict";
import { LarkNotifier, sanitizeLarkTextContent, splitForLarkText, stripInternalCodexMetadata } from "../src/notifier.mjs";

test("LarkNotifier.checkAuth reports missing credentials without throwing", async () => {
  const notifier = new LarkNotifier({ appId: "", appSecret: "" });
  const result = await notifier.checkAuth();
  assert.equal(result.ok, false);
  assert.equal(result.hasCredentials, false);
});

test("LarkNotifier uses the configured international OpenAPI domain", async (t) => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return Response.json({ code: 0, tenant_access_token: "token", expire: 3600 });
  };

  const notifier = new LarkNotifier({ appId: "cli_test", appSecret: "secret", domain: "lark" });
  const result = await notifier.checkAuth();

  assert.equal(result.ok, true);
  assert.equal(result.domain, "lark");
  assert.equal(result.baseUrl, "https://open.larksuite.com");
  assert.match(urls[0], /^https:\/\/open\.larksuite\.com\/open-apis\/auth\/v3\/tenant_access_token\/internal$/);
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

test("LarkNotifier.send proactively sends text to a Feishu chat", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("/auth/v3/tenant_access_token/internal")) {
      return Response.json({ code: 0, tenant_access_token: "token", expire: 3600 });
    }
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({ code: 0, data: { message_id: "om_startup" } });
  };

  const notifier = new LarkNotifier({ appId: "cli_test", appSecret: "secret" });
  const result = await notifier.send("oc_test", "hello", { receiveIdType: "chat_id" });

  assert.equal(result.ok, true);
  assert.equal(result.messageId, "om_startup");
  assert.match(requests[0].url, /\/im\/v1\/messages\?receive_id_type=chat_id$/);
  assert.equal(requests[0].body.receive_id, "oc_test");
  assert.equal(requests[0].body.msg_type, "text");
  assert.deepEqual(JSON.parse(requests[0].body.content), { text: "hello" });
});

test("LarkNotifier.sendCard proactively sends an interactive card", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("/auth/v3/tenant_access_token/internal")) {
      return Response.json({ code: 0, tenant_access_token: "token", expire: 3600 });
    }
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({ code: 0, data: { message_id: "om_card_startup" } });
  };

  const card = { elements: [{ tag: "markdown", content: "hello" }] };
  const notifier = new LarkNotifier({ appId: "cli_test", appSecret: "secret" });
  const result = await notifier.sendCard("oc_test", card);

  assert.equal(result.ok, true);
  assert.equal(result.messageId, "om_card_startup");
  assert.equal(requests[0].body.receive_id, "oc_test");
  assert.equal(requests[0].body.msg_type, "interactive");
  assert.deepEqual(JSON.parse(requests[0].body.content), card);
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

test("LarkNotifier.reply strips internal Codex memory citations before sending", async (t) => {
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
    return Response.json({ code: 0, data: { message_id: "om_reply" } });
  };

  const text = [
    "已完成。",
    "",
    "<oai-mem-citation>",
    "<citation_entries>",
    "MEMORY.md:143-190|note=[internal]",
    "</citation_entries>",
    "<rollout_ids>",
    "019ea241-0602-7f20-959b-3f2888998db0",
    "</rollout_ids>",
    "</oai-mem-citation>",
  ].join("\n");
  const notifier = new LarkNotifier({ appId: "cli_test", appSecret: "secret" });
  const result = await notifier.reply("om_test", text);

  assert.equal(result.ok, true);
  assert.deepEqual(sentTexts, ["已完成。"]);
});

test("LarkNotifier.reply strips unsupported image content before sending", async (t) => {
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
    return Response.json({ code: 0, data: { message_id: "om_reply" } });
  };

  const text = [
    "处理完成。",
    "![截图](/tmp/codex-output.png)",
    '<img src="file:///tmp/codex-output.jpg" alt="screenshot">',
    "/tmp/only-image.webp",
    "文字继续。",
  ].join("\n");
  const notifier = new LarkNotifier({ appId: "cli_test", appSecret: "secret" });
  const result = await notifier.reply("om_test", text);

  assert.equal(result.ok, true);
  assert.deepEqual(sentTexts, ["处理完成。\n文字继续。"]);
});

test("LarkNotifier.reply skips image-only content without calling Feishu APIs", async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ code: 0, tenant_access_token: "token", expire: 3600 });
  };

  const notifier = new LarkNotifier({ appId: "cli_test", appSecret: "secret" });
  const result = await notifier.reply("om_test", "![截图](/tmp/codex-output.png)");

  assert.equal(result.ok, true);
  assert.equal(result.filtered, true);
  assert.equal(result.deliveredParts, 0);
  assert.equal(fetchCount, 0);
});

test("LarkNotifier.sendCard removes unsupported image elements and markdown images", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("/auth/v3/tenant_access_token/internal")) {
      return Response.json({ code: 0, tenant_access_token: "token", expire: 3600 });
    }
    requests.push(JSON.parse(init.body));
    return Response.json({ code: 0, data: { message_id: "om_card" } });
  };

  const notifier = new LarkNotifier({ appId: "cli_test", appSecret: "secret" });
  const result = await notifier.sendCard("oc_test", {
    elements: [
      { tag: "markdown", content: "上文\n![截图](/tmp/codex-output.png)\n下文" },
      { tag: "img", img_key: "img_v3_123", alt: { tag: "plain_text", content: "screenshot" } },
      { tag: "markdown", content: "<img src=\"https://example.com/a.png\">" },
    ],
  });

  assert.equal(result.ok, true);
  const content = JSON.parse(requests[0].content);
  assert.deepEqual(content.elements, [{ tag: "markdown", content: "上文\n下文" }]);
});

test("splitForLarkText prefers newline boundaries", () => {
  assert.deepEqual(splitForLarkText("a\nb\nc", 4), ["a\nb\n", "c"]);
});

test("stripInternalCodexMetadata removes complete and partial memory citation blocks", () => {
  assert.equal(
    stripInternalCodexMetadata("A\n<oai-mem-citation>\nsecret\n</oai-mem-citation>\nB"),
    "A\nB",
  );
  assert.equal(
    stripInternalCodexMetadata("A\n<oai-mem-citation>\nsecret"),
    "A",
  );
});

test("sanitizeLarkTextContent removes common image-only blocks", () => {
  assert.equal(
    sanitizeLarkTextContent("A\n<<ImageDisplayed>>\n![cap][ref]\n[ref]: /tmp/a.png\nB"),
    "A\nB",
  );
});
