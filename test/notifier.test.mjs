import test from "node:test";
import assert from "node:assert/strict";
import { LarkNotifier } from "../src/notifier.mjs";

test("LarkNotifier.checkAuth reports missing credentials without throwing", async () => {
  const notifier = new LarkNotifier({ appId: "", appSecret: "" });
  const result = await notifier.checkAuth();
  assert.equal(result.ok, false);
  assert.equal(result.hasCredentials, false);
});

