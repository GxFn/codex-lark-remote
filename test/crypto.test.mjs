import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createLarkSignature, decryptLarkPayload, encryptLarkPayload, verifyLarkSignature } from "../src/crypto.mjs";

test("encryptLarkPayload and decryptLarkPayload round-trip Lark event bodies", () => {
  const encryptKey = "0123456789abcdef0123456789abcdef";
  const iv = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const payload = {
    schema: "2.0",
    header: { event_type: "im.message.receive_v1", token: "verification_token" },
    event: { message: { message_id: "om_123" } },
  };

  const encrypted = encryptLarkPayload(payload, encryptKey, iv);
  const decrypted = decryptLarkPayload(encrypted, encryptKey);

  assert.deepEqual(decrypted, payload);
});

test("decryptLarkPayload rejects missing key or malformed ciphertext", () => {
  assert.throws(() => decryptLarkPayload("too-short", ""), /encryptKey is not configured/);
  assert.throws(() => decryptLarkPayload(Buffer.alloc(16).toString("base64"), "key"), /payload is too short/);
});

test("verifyLarkSignature validates signed raw webhook bodies", () => {
  const rawBody = JSON.stringify({ encrypt: "abc123" });
  const encryptKey = "0123456789abcdef0123456789abcdef";
  const timestamp = "1710000000";
  const nonce = "nonce_1";
  const signature = createLarkSignature({ timestamp, nonce, encryptKey, rawBody });
  assert.equal(signature, crypto.createHash("sha256").update(`${timestamp}${nonce}${encryptKey}${rawBody}`).digest("hex"));

  assert.deepEqual(
    verifyLarkSignature({
      rawBody,
      encryptKey,
      headers: {
        "x-lark-request-timestamp": timestamp,
        "x-lark-request-nonce": nonce,
        "x-lark-signature": signature,
      },
    }),
    { checked: true, ok: true, reason: "Invalid Lark signature" },
  );

  const invalid = verifyLarkSignature({
    rawBody,
    encryptKey,
    headers: {
      "x-lark-request-timestamp": timestamp,
      "x-lark-request-nonce": nonce,
      "x-lark-signature": "00",
    },
  });
  assert.equal(invalid.checked, true);
  assert.equal(invalid.ok, false);
});

test("verifyLarkSignature stays optional when no signature headers are present", () => {
  assert.deepEqual(
    verifyLarkSignature({
      rawBody: JSON.stringify({ event: {} }),
      encryptKey: "0123456789abcdef0123456789abcdef",
      headers: {},
    }),
    { checked: false, ok: true },
  );
});
