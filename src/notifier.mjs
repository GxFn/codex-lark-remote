import { larkDomainInfo, larkOpenApiUrl } from "./lark-domain.mjs";

export class LarkNotifier {
  constructor({ appId = process.env.CODEX_LARK_APP_ID, appSecret = process.env.CODEX_LARK_APP_SECRET, ...options } = {}) {
    this.appId = appId || "";
    this.appSecret = appSecret || "";
    this.domain = larkDomainInfo(options);
    this.tenantToken = "";
    this.tenantTokenExpiresAt = 0;
  }

  async checkAuth() {
    if (!this.appId || !this.appSecret) {
      return { ok: false, hasCredentials: false, message: "Missing Lark appId/appSecret" };
    }
    const token = await this.#tenantToken();
    return {
      ok: Boolean(token),
      hasCredentials: true,
      appIdPrefix: `${this.appId.slice(0, 8)}...`,
      domain: this.domain.key,
      baseUrl: this.domain.baseUrl,
      message: token ? "Tenant access token acquired" : "Tenant access token request failed",
    };
  }

  async reply(messageId, text) {
    return this.replyMessage(messageId, {
      msgType: "text",
      chunks: textChunksForLark(text).map((chunk) => ({ text: chunk })),
    });
  }

  async send(receiveId, text, options = {}) {
    return this.sendMessage(receiveId, {
      receiveIdType: options.receiveIdType || "chat_id",
      msgType: "text",
      chunks: textChunksForLark(text).map((chunk) => ({ text: chunk })),
    });
  }

  async sendCard(receiveId, card, options = {}) {
    const cleanCard = sanitizeLarkCard(card);
    return this.sendMessage(receiveId, {
      receiveIdType: options.receiveIdType || "chat_id",
      msgType: "interactive",
      chunks: cleanCard ? [cleanCard] : [],
    });
  }

  async replyCard(messageId, card) {
    const cleanCard = sanitizeLarkCard(card);
    return this.replyMessage(messageId, {
      msgType: "interactive",
      content: cleanCard,
      chunks: cleanCard ? [cleanCard] : [],
    });
  }

  async patchCard(messageId, card) {
    if (!messageId) return { ok: false, error: "Missing Lark message id" };
    const cleanCard = sanitizeLarkCard(card);
    if (!cleanCard) return noContentDelivery();
    if (!this.appId || !this.appSecret) return { ok: false, error: "Missing Lark appId/appSecret" };
    const token = await this.#tenantToken();
    if (!token) return { ok: false, error: "Missing Lark tenant access token" };
    const response = await fetch(this.#url(`/open-apis/im/v1/messages/${messageId}`), {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msg_type: "interactive",
        content: JSON.stringify(cleanCard),
      }),
    });
    return larkDeliveryResult(response, { messageIds: [], totalParts: 1 });
  }

  async updateCardByToken(token, card) {
    if (!token) return { ok: false, error: "Missing Lark card update token" };
    const cleanCard = sanitizeLarkCard(card);
    if (!cleanCard) return noContentDelivery();
    const response = await fetch(this.#url("/open-apis/interactive/v1/card/update"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, card: cleanCard }),
    });
    return larkDeliveryResult(response, { messageIds: [], totalParts: 1 });
  }

  async replyMessage(messageId, { msgType, chunks }) {
    if (!messageId) return { ok: false, error: "Missing Lark message id" };
    if (!chunks.length) return noContentDelivery();
    if (!this.appId || !this.appSecret) return { ok: false, error: "Missing Lark appId/appSecret" };
    const token = await this.#tenantToken();
    if (!token) return { ok: false, error: "Missing Lark tenant access token" };
    const messageIds = [];
    for (const chunk of chunks) {
      const response = await fetch(this.#url(`/open-apis/im/v1/messages/${messageId}/reply`), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          msg_type: msgType,
          content: JSON.stringify(chunk),
        }),
      });
      const result = await larkDeliveryResult(response, { messageIds, totalParts: chunks.length });
      if (!result.ok) return result;
      const deliveredId = result.data?.data?.message_id || result.data?.data?.messageId || "";
      if (deliveredId) messageIds.push(deliveredId);
    }
    return {
      ok: true,
      status: 200,
      code: 0,
      messageId: messageIds[0] || "",
      messageIds,
      deliveredParts: chunks.length,
      totalParts: chunks.length,
    };
  }

  async sendMessage(receiveId, { receiveIdType = "chat_id", msgType, chunks }) {
    if (!receiveId) return { ok: false, error: "Missing Lark receive id" };
    if (!chunks.length) return noContentDelivery();
    if (!this.appId || !this.appSecret) return { ok: false, error: "Missing Lark appId/appSecret" };
    const token = await this.#tenantToken();
    if (!token) return { ok: false, error: "Missing Lark tenant access token" };
    const safeReceiveIdType = encodeURIComponent(receiveIdType || "chat_id");
    const messageIds = [];
    for (const chunk of chunks) {
      const response = await fetch(this.#url(`/open-apis/im/v1/messages?receive_id_type=${safeReceiveIdType}`), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: msgType,
          content: JSON.stringify(chunk),
        }),
      });
      const result = await larkDeliveryResult(response, { messageIds, totalParts: chunks.length });
      if (!result.ok) return result;
      const deliveredId = result.data?.data?.message_id || result.data?.data?.messageId || "";
      if (deliveredId) messageIds.push(deliveredId);
    }
    return {
      ok: true,
      status: 200,
      code: 0,
      messageId: messageIds[0] || "",
      messageIds,
      deliveredParts: chunks.length,
      totalParts: chunks.length,
    };
  }

  async #tenantToken() {
    if (this.tenantToken && Date.now() < this.tenantTokenExpiresAt) return this.tenantToken;
    const response = await fetch(this.#url("/open-apis/auth/v3/tenant_access_token/internal"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    });
    if (!response.ok) return "";
    const data = await response.json();
    if (data.code === 0 && data.tenant_access_token) {
      this.tenantToken = data.tenant_access_token;
      this.tenantTokenExpiresAt = Date.now() + Math.max(60, Number(data.expire || 3600) - 60) * 1000;
      return this.tenantToken;
    }
    return "";
  }

  #url(path) {
    return larkOpenApiUrl(this.domain, path);
  }
}

function noContentDelivery() {
  return {
    ok: true,
    status: 204,
    code: 0,
    messageId: "",
    messageIds: [],
    deliveredParts: 0,
    totalParts: 0,
    filtered: true,
  };
}

async function larkDeliveryResult(response, { messageIds = [], totalParts = 1 } = {}) {
  const data = await readJsonSafe(response);
  const code = data?.code;
  const larkOk = code === undefined || code === 0;
  if (!response.ok || !larkOk) {
    return {
      ok: false,
      status: response.status,
      code,
      error: data?.msg || data?.message || data?.error || response.statusText || "Lark request failed",
      messageIds,
      deliveredParts: messageIds.length,
      totalParts,
    };
  }
  return {
    ok: true,
    status: response.status,
    code: code || 0,
    data,
  };
}

export function truncateForLark(text, max = 3000) {
  const value = sanitizeLarkTextContent(text);
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n... truncated`;
}

export function splitForLarkText(text, max = 2800) {
  const value = sanitizeLarkTextContent(text);
  if (!value) return [""];
  if (value.length <= max) return [value];

  const chunks = [];
  let current = "";
  const pushCurrent = () => {
    if (current) {
      chunks.push(current);
      current = "";
    }
  };

  for (const line of value.split(/(\n)/)) {
    if (!line) continue;
    if (line.length > max) {
      pushCurrent();
      for (let index = 0; index < line.length; index += max) {
        chunks.push(line.slice(index, index + max));
      }
      continue;
    }
    if (current.length + line.length > max) pushCurrent();
    current += line;
  }
  pushCurrent();
  return chunks.length ? chunks : [""];
}

function textChunksForLark(text) {
  return splitForLarkText(text).filter((chunk) => chunk.trim());
}

export function sanitizeLarkTextContent(text) {
  return stripUnsupportedImageContent(stripInternalCodexMetadata(text));
}

export function stripInternalCodexMetadata(text) {
  const value = String(text || "");
  if (!/<(?:oai-mem-citation|environment_context|app-context|skills_instructions|plugins_instructions|collaboration_mode)\b/i.test(value)
    && !/<permissions\s+instructions\b/i.test(value)) return value;
  return value
    .replace(/\n*<oai-mem-citation\b[^>]*>[\s\S]*?<\/oai-mem-citation>\n*/gi, "\n")
    .replace(/\n*<oai-mem-citation\b[^>]*>[\s\S]*$/gi, "")
    .replace(/\n*<environment_context\b[^>]*>[\s\S]*?<\/environment_context>\n*/gi, "\n")
    .replace(/\n*<environment_context\b[^>]*>[\s\S]*$/gi, "")
    .replace(/\n*<permissions\s+instructions\b[^>]*>[\s\S]*?<\/permissions\s+instructions>\n*/gi, "\n")
    .replace(/\n*<permissions\s+instructions\b[^>]*>[\s\S]*$/gi, "")
    .replace(/\n*<app-context\b[^>]*>[\s\S]*?<\/app-context>\n*/gi, "\n")
    .replace(/\n*<app-context\b[^>]*>[\s\S]*$/gi, "")
    .replace(/\n*<skills_instructions\b[^>]*>[\s\S]*?<\/skills_instructions>\n*/gi, "\n")
    .replace(/\n*<skills_instructions\b[^>]*>[\s\S]*$/gi, "")
    .replace(/\n*<plugins_instructions\b[^>]*>[\s\S]*?<\/plugins_instructions>\n*/gi, "\n")
    .replace(/\n*<plugins_instructions\b[^>]*>[\s\S]*$/gi, "")
    .replace(/\n*<collaboration_mode\b[^>]*>[\s\S]*?<\/collaboration_mode>\n*/gi, "\n")
    .replace(/\n*<collaboration_mode\b[^>]*>[\s\S]*$/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripUnsupportedImageContent(text) {
  const value = String(text || "");
  if (!looksLikeImageContent(value)) return value;
  return value
    .replace(/!\[[^\]\n]*\]\([^)]+\)/g, "")
    .replace(/!\[[^\]\n]*\]\[[^\]\n]*\]/g, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<picture\b[\s\S]*?<\/picture>/gi, "")
    .split(/\n/)
    .filter((line) => !isStandaloneImageLine(line))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeImageContent(value) {
  return /!\[[^\]\n]*\]\([^)]+\)|!\[[^\]\n]*\]\[[^\]\n]*\]|<img\b|<picture\b|data:image\/|<<ImageDisplayed>>|(?:^|\s)(?:file:\/\/|https?:\/\/|\/|~\/|\.\.?\/)[^\s)]+\.(?:png|jpe?g|gif|webp|heic|heif|bmp|tiff?)(?:[?#][^\s)]*)?/im.test(String(value || ""));
}

function isStandaloneImageLine(line) {
  const text = String(line || "").trim();
  if (!text) return true;
  if (/^(?:<<ImageDisplayed>>|\[image(?:\s+\d+)?\]|<image\b[^>]*>|<\/image>)$/i.test(text)) return true;
  if (/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(text)) return true;
  if (/^\[[^\]]+\]:\s*(?:file:\/\/|https?:\/\/|\/|~\/|\.\.?\/)[^\s)]+\.(?:png|jpe?g|gif|webp|heic|heif|bmp|tiff?)(?:[?#][^\s)]*)?(?:\s+["'][^"']*["'])?$/i.test(text)) return true;
  return /^(?:file:\/\/|https?:\/\/|\/|~\/|\.\.?\/)[^\s)]+\.(?:png|jpe?g|gif|webp|heic|heif|bmp|tiff?)(?:[?#][^\s)]*)?$/i.test(text);
}

function sanitizeLarkCard(card) {
  const clean = sanitizeCardNode(card);
  return hasRenderableCardContent(clean) ? clean : null;
}

function sanitizeCardNode(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeCardNode(item))
      .filter((item) => item !== null && item !== undefined);
  }
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? sanitizeLarkTextContent(value) : value;
  }
  const tag = String(value.tag || "").toLowerCase();
  if (["img", "image", "media"].includes(tag)) return null;
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    const next = sanitizeCardNode(item);
    if (next === null || next === undefined) continue;
    clean[key] = next;
  }
  if ((tag === "markdown" || tag === "plain_text") && typeof clean.content === "string" && !clean.content.trim()) return null;
  return clean;
}

function hasRenderableCardContent(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasRenderableCardContent);
  if (typeof value.content === "string" && value.content.trim()) return true;
  if (value.config && typeof value.config === "object" && Object.keys(value.config).length) return true;
  if (value.card_link && typeof value.card_link === "object" && Object.keys(value.card_link).length) return true;
  if (value.text && hasRenderableCardContent(value.text)) return true;
  if (Array.isArray(value.elements) && value.elements.length) return true;
  if (value.header && hasRenderableCardContent(value.header)) return true;
  return false;
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
