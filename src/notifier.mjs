export class LarkNotifier {
  constructor({ appId = process.env.CODEX_LARK_APP_ID, appSecret = process.env.CODEX_LARK_APP_SECRET } = {}) {
    this.appId = appId || "";
    this.appSecret = appSecret || "";
    this.tenantToken = "";
    this.tenantTokenExpiresAt = 0;
  }

  async reply(messageId, text) {
    if (!messageId || !this.appId || !this.appSecret) return false;
    const token = await this.#tenantToken();
    if (!token) return false;
    const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msg_type: "text",
        content: JSON.stringify({ text: truncateForLark(text) }),
      }),
    });
    return response.ok;
  }

  async #tenantToken() {
    if (this.tenantToken && Date.now() < this.tenantTokenExpiresAt) return this.tenantToken;
    const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
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
}

export function truncateForLark(text, max = 3000) {
  const value = String(text || "");
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n... truncated`;
}

