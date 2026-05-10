import { parseCsv, shortHash } from "./config.mjs";

export function parseLarkEvent(body) {
  if (body?.type === "url_verification" || body?.challenge) {
    return { kind: "url_verification", challenge: body.challenge };
  }

  const event = body?.event || body;
  const message = event?.message || body?.message || {};
  const sender = event?.sender || body?.sender || {};
  const senderIds = sender?.sender_id || {};
  const senderId = senderIds.user_id || senderIds.open_id || "";
  const senderIdType = senderIds.user_id ? "user_id" : senderIds.open_id ? "open_id" : "";
  const messageType = message.message_type || "";
  const messageId = message.message_id || "";
  const chatId = message.chat_id || "";

  let text = "";
  if (messageType === "text" || message.content) {
    try {
      const content = typeof message.content === "string" ? JSON.parse(message.content) : message.content;
      text = String(content?.text || "").trim();
    } catch {
      text = "";
    }
  }
  text = normalizeText(text);

  return {
    kind: "message",
    messageType,
    messageId,
    chatId,
    senderId,
    senderIdType,
    openId: senderIds.open_id || "",
    unionId: senderIds.union_id || "",
    senderName: senderId || "lark_user",
    text,
    chatIdHash: chatId ? `c_${shortHash(chatId)}` : "",
    userIdHash: senderId ? `u_${shortHash(senderId)}` : "",
  };
}

export function isUserAllowed(senderId, config = {}) {
  const allowed = configuredAllowedUsers(config);
  if (allowed.length === 0) return true;
  return allowed.includes(senderId);
}

export function configuredAllowedUsers(config = {}) {
  const configured = config.lark?.allowedUsers ?? process.env.CODEX_LARK_ALLOWED_USERS;
  if (Array.isArray(configured)) {
    return configured.map((item) => String(item).trim()).filter(Boolean);
  }
  return parseCsv(configured);
}

export function classifyChatText(text, config) {
  const trimmed = normalizeText(text);
  if (!trimmed) return { kind: "empty" };

  const command = parseManagementCommand(trimmed);
  if (command) return command;

  if (trimmed.startsWith("$")) {
    return {
      kind: "rejected",
      reason: "Shell commands are not enabled in the first version. Send a coding request instead.",
    };
  }

  const forced = trimmed.startsWith(">");
  const withoutPrefix = forced ? normalizeText(trimmed.slice(1)) : trimmed;
  const { repoKey, taskText } = parseRepoPrefix(withoutPrefix, config);
  if (!taskText) return { kind: "empty" };
  return {
    kind: "task",
    forced,
    repoKey,
    taskText,
  };
}

export function normalizeText(text) {
  return String(text || "")
    .replace(/@_user_\d+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseManagementCommand(text) {
  const match = text.match(/^\/codex(?:\s+(.+))?$/i);
  if (!match) return null;
  const rest = normalizeText(match[1] || "help");
  const [action, id, subAction] = rest.split(/\s+/);
  if (!action || action === "help") return { kind: "help" };
  if (action === "whoami") return { kind: "whoami" };
  if (action === "status") return id ? { kind: "task_status", id } : { kind: "status" };
  if (action === "diff" && id) return { kind: "task_diff", id };
  if (action === "cancel" && id) return { kind: "cancel", id };
  if (action === "approve" && id && subAction) return { kind: "approve", id, action: subAction };
  return { kind: "help" };
}

function parseRepoPrefix(text, config) {
  const match = text.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (match) {
    return { repoKey: match[1].trim(), taskText: match[2].trim() };
  }
  return { repoKey: config.defaultRepo || Object.keys(config.repos || {})[0] || "", taskText: text };
}
