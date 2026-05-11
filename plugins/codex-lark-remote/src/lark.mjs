import { parseCsv, shortHash } from "./config.mjs";

const COMMAND_ID_RE = /\b(rcmd_[a-z0-9]+_[a-z0-9]+)\b/i;

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
  const naturalCommand = parseNaturalManagementCommand(trimmed);
  if (naturalCommand) return naturalCommand;

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
  if (["command", "commands", "show-commands"].includes(action)) {
    if (["on", "enable", "enabled", "show", "true"].includes(id)) return { kind: "command_visibility", enabled: true };
    if (["off", "disable", "disabled", "hide", "false"].includes(id)) return { kind: "command_visibility", enabled: false };
    return { kind: "command_visibility" };
  }
  if (action === "handoff") {
    if (id === "off" || id === "stop" || id === "disable") return { kind: "handoff_disable" };
    return { kind: "handoff_status" };
  }
  if (action === "diff" && id) return { kind: "task_diff", id };
  if (action === "cancel" && id) return { kind: "cancel", id };
  if (action === "approve" && id && subAction) return { kind: "approve", id, action: subAction };
  return { kind: "help" };
}

function parseNaturalManagementCommand(text) {
  const normalized = normalizeText(text).toLowerCase();
  const id = extractCommandId(normalized);

  if (/^(帮助|使用帮助|怎么用|如何使用|有哪些命令|命令列表|help)[。.!！]?$/.test(normalized)) return { kind: "help" };
  if (/^(我是谁|我的id|我的 id|查看我的id|查看我的 id|获取我的id|获取我的 id|whoami)[。.!！]?$/.test(normalized)) {
    return { kind: "whoami" };
  }

  if (/^(状态|查看状态|看下状态|看看状态|现在状态|当前状态|连接状态|插件状态|飞书状态|lark状态|lark status|status)[。.!！]?$/.test(normalized)) {
    return { kind: "status" };
  }
  if (/^(接管状态|查看接管|看下接管|当前接管|是否接管|还在接管吗|handoff status)[。.?？!！]?$/.test(normalized)) {
    return { kind: "handoff_status" };
  }

  if (/^(命令显示状态|查看命令显示|commands status|command status|show commands status)[。.?？!！]?$/.test(normalized)) {
    return { kind: "command_visibility" };
  }
  if (/^(打开|开启|启用|显示|展示)(命令|命令显示|command display|commands|show commands)吧?[。.!！]?$/.test(normalized)
    || /^(commands on|command on|show commands|show commands on|enable commands)[。.!！]?$/.test(normalized)) {
    return { kind: "command_visibility", enabled: true };
  }
  if (/^(关闭|关掉|停止|禁用|隐藏)(命令|命令显示|command display|commands|show commands)吧?[。.!！]?$/.test(normalized)
    || /^(不要|别)(显示|展示)?(命令|命令显示)了?[。.!！]?$/.test(normalized)
    || /^(commands off|command off|hide commands|disable commands)[。.!！]?$/.test(normalized)) {
    return { kind: "command_visibility", enabled: false };
  }

  if (/^断开(连接|接管)?吧?[。.!！]?$/.test(normalized)) return { kind: "handoff_disable" };
  if (/^(关闭|停止|结束|退出)(连接|接管|远程接管|飞书接管|lark remote|codex lark remote)吧?[。.!！]?$/.test(normalized)) {
    return { kind: "handoff_disable" };
  }
  if (/^(不要|别)(继续)?(接管|远程接管|飞书接管)了?[。.!！]?$/.test(normalized)) return { kind: "handoff_disable" };
  if (/^(停止|关闭|退出|结束|断开)吧?[。.!！]?$/.test(normalized)) return { kind: "handoff_disable" };

  if (id) {
    const approvalAction = parseNaturalApprovalAction(normalized);
    if (approvalAction) return { kind: "approve", id, action: approvalAction };
    if (/(取消|停止|终止|删掉|删除).*(任务|task|rcmd)|^(取消|停止|终止)/.test(normalized)) return { kind: "cancel", id };
    if (/(diff|改动|变更|修改|变化)/.test(normalized)) return { kind: "task_diff", id };
    if (/(状态|进度|详情|结果|查看|看看|看一下|查一下|task)/.test(normalized)) return { kind: "task_status", id };
  }
  return null;
}

function extractCommandId(text) {
  return text.match(COMMAND_ID_RE)?.[1] || "";
}

function parseNaturalApprovalAction(text) {
  if (!/(批准|通过|同意|允许|approve)/.test(text)) return "";
  if (/\bpush\b|推送|发布/.test(text)) return "push";
  if (/\bcommit\b|提交/.test(text)) return "commit";
  if (/\btest\b|测试|跑测试/.test(text)) return "test";
  if (/\breview\b|审查|审核|确认/.test(text)) return "review";
  return "";
}

function parseRepoPrefix(text, config) {
  const match = text.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (match) {
    return { repoKey: match[1].trim(), taskText: match[2].trim() };
  }
  return { repoKey: config.defaultRepo || Object.keys(config.repos || {})[0] || "", taskText: text };
}
