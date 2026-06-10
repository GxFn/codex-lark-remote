import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeBridgeStatus } from "../plugins/codex-lark-remote/src/sanitize.mjs";

test("sanitizeBridgeStatus redacts local bridge credentials", () => {
  const status = sanitizeBridgeStatus({
    running: false,
    state: {
      url: "http://127.0.0.1:12345",
      token: "bridge-token",
    },
    config: {
      lark: {
        appId: "cli_a1234567890",
        appSecret: "secret-value",
        verificationToken: "verify-value",
        encryptKey: "encrypt-value",
        allowedUsers: ["ou_1"],
      },
    },
  });
  const text = JSON.stringify(status);

  assert.doesNotMatch(text, /secret-value/);
  assert.doesNotMatch(text, /verify-value/);
  assert.doesNotMatch(text, /encrypt-value/);
  assert.doesNotMatch(text, /bridge-token/);
  assert.doesNotMatch(text, /ou_1/);
  assert.match(text, /\[configured\]/);
  assert.match(text, /\[1 configured\]/);
});
