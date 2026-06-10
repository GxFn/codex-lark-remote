#!/usr/bin/env node
import fs from "node:fs/promises";
import { loadConfig, resolveDataDir, stateFilePath } from "../plugins/codex-lark-remote/src/config.mjs";
import { createLarkSignature, encryptLarkPayload } from "../plugins/codex-lark-remote/src/crypto.mjs";

const args = parseArgs(process.argv.slice(2));
const dataDir = resolveDataDir(args.dataDir);
const config = await loadConfig({ dataDir, configPath: args.config });
const state = await readState(dataDir);
const bridgeUrl = args.url || state?.url;
if (!bridgeUrl) throw new Error("Bridge URL not found. Start bridge first or pass --url.");

const body = buildBody({ args, config });
const rawBody = JSON.stringify(body);
const headers = {
  "Content-Type": "application/json",
  ...signatureHeaders({ args, config, rawBody }),
};
const response = await fetch(`${bridgeUrl}/bridge/lark/event`, {
  method: "POST",
  headers,
  body: rawBody,
});

const text = await response.text();
console.log(
  JSON.stringify(
    {
      ok: response.ok,
      status: response.status,
      encrypted: Boolean(args.encrypt),
      signed: Boolean(args.sign),
      response: parseMaybeJson(text),
    },
    null,
    2,
  ),
);

function buildBody({ args, config }) {
  const payload =
    args.kind === "challenge"
      ? {
          type: "url_verification",
          challenge: args.challenge || "codex-lark-remote-challenge",
          token: config.lark?.verificationToken || "",
        }
      : {
          schema: "2.0",
          header: {
            event_type: "im.message.receive_v1",
            token: config.lark?.verificationToken || "",
          },
          event: {
            sender: {
              sender_id: {
                user_id: args.user || "fixture_user",
                open_id: args.user || "fixture_user",
              },
            },
            message: {
              message_id: args.messageId || `om_fixture_${Date.now()}`,
              chat_id: args.chat || "oc_fixture_chat",
              message_type: "text",
              content: JSON.stringify({ text: args.text || "[codex-lark-remote] local fixture task" }),
            },
          },
        };

  if (!args.encrypt) return payload;
  return { encrypt: encryptLarkPayload(payload, config.lark?.encryptKey || args.encryptKey || "") };
}

function signatureHeaders({ args, config, rawBody }) {
  if (!args.sign) return {};
  const encryptKey = config.lark?.encryptKey || args.encryptKey || "";
  if (!encryptKey) throw new Error("--sign requires lark.encryptKey or --encrypt-key");
  const timestamp = args.timestamp || String(Math.floor(Date.now() / 1000));
  const nonce = args.nonce || `fixture_${Date.now()}`;
  return {
    "X-Lark-Request-Timestamp": timestamp,
    "X-Lark-Request-Nonce": nonce,
    "X-Lark-Signature": createLarkSignature({ timestamp, nonce, encryptKey, rawBody }),
  };
}

async function readState(dataDir) {
  try {
    return JSON.parse(await fs.readFile(stateFilePath(dataDir), "utf8"));
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const result = { kind: "message" };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--data-dir") result.dataDir = argv[++index];
    else if (item === "--config") result.config = argv[++index];
    else if (item === "--url") result.url = argv[++index];
    else if (item === "--text") result.text = argv[++index];
    else if (item === "--user") result.user = argv[++index];
    else if (item === "--chat") result.chat = argv[++index];
    else if (item === "--message-id") result.messageId = argv[++index];
    else if (item === "--challenge") result.kind = "challenge";
    else if (item === "--encrypt") result.encrypt = true;
    else if (item === "--encrypt-key") result.encryptKey = argv[++index];
    else if (item === "--sign") result.sign = true;
    else if (item === "--timestamp") result.timestamp = argv[++index];
    else if (item === "--nonce") result.nonce = argv[++index];
    else if (item === "--help") {
      console.log(helpText());
      process.exit(0);
    }
  }
  return result;
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function helpText() {
  return [
    "Usage: node scripts/lark-event-fixture.mjs [options]",
    "",
    "Options:",
    "  --data-dir <dir>       Lark Remote data directory",
    "  --config <path>        Config path",
    "  --url <url>            Bridge URL, defaults to state file",
    "  --text <text>          Message text",
    "  --user <id>            Sender user/open id",
    "  --chat <id>            Chat id",
    "  --message-id <id>      Message id",
    "  --challenge           Send url_verification payload",
    "  --encrypt             Wrap payload in Feishu/Lark encrypt field",
    "  --encrypt-key <key>    Encrypt key override for --encrypt or --sign",
    "  --sign                Send X-Lark signature headers",
    "  --timestamp <value>    Signature timestamp override",
    "  --nonce <value>        Signature nonce override",
  ].join("\n");
}
