import test from "node:test";
import assert from "node:assert/strict";
import { LarkWebSocketReceiver, larkWebSocketEnabled } from "../src/lark-ws.mjs";

test("larkWebSocketEnabled defaults to websocket-first", () => {
  assert.equal(larkWebSocketEnabled({ lark: {} }), true);
  assert.equal(larkWebSocketEnabled({ lark: { transport: "webhook" } }), false);
  assert.equal(larkWebSocketEnabled({ lark: { websocket: false } }), false);
});

test("LarkWebSocketReceiver starts SDK client and forwards message events", async () => {
  const received = [];
  const fakeSdk = createFakeLarkSdk();
  const receiver = new LarkWebSocketReceiver({
    config: { lark: { appId: "cli_test", appSecret: "secret" } },
    onEvent: (event) => received.push(event),
    sdkLoader: async () => fakeSdk,
    logger: { error() {} },
  });

  const status = await receiver.start();
  assert.equal(status.connected, true);
  assert.equal(fakeSdk.WSClient.last.options.appId, "cli_test");

  await fakeSdk.EventDispatcher.last.handlers["im.message.receive_v1"]({ event: { message: { message_id: "om_1" } } });
  assert.equal(received.length, 1);
  assert.equal(received[0].event.message.message_id, "om_1");
  assert.match(receiver.status().lastEventAt, /^\d{4}-\d{2}-\d{2}T/);

  receiver.stop();
  assert.equal(receiver.status().connected, false);
});

test("LarkWebSocketReceiver reports missing credentials without throwing", async () => {
  const receiver = new LarkWebSocketReceiver({ config: { lark: {} } });
  const status = await receiver.start();
  assert.equal(status.connected, false);
  assert.equal(status.message, "Missing Lark appId/appSecret");
});

function createFakeLarkSdk() {
  class EventDispatcher {
    static last;

    constructor() {
      EventDispatcher.last = this;
      this.handlers = {};
    }

    register(handlers) {
      this.handlers = handlers;
      return this;
    }
  }

  class WSClient {
    static last;

    constructor(options) {
      WSClient.last = this;
      this.options = options;
      this.closed = false;
    }

    async start() {
      this.started = true;
    }

    close() {
      this.closed = true;
    }
  }

  return { EventDispatcher, WSClient, LoggerLevel: { info: 2 } };
}
