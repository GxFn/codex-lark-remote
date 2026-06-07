const DOMAIN_PRESETS = {
  feishu: {
    key: "feishu",
    label: "Feishu China",
    baseUrl: "https://open.feishu.cn",
    sdkKey: "Feishu",
  },
  lark: {
    key: "lark",
    label: "Lark international",
    baseUrl: "https://open.larksuite.com",
    sdkKey: "Lark",
  },
};

const FEISHU_ALIASES = new Set(["", "feishu", "cn", "china", "domestic", "zh-cn"]);
const LARK_ALIASES = new Set(["lark", "intl", "international", "global", "overseas", "larksuite"]);

export function larkDomainInfo(config = {}) {
  const larkConfig = config.lark || config || {};
  const explicitBaseUrl =
    larkConfig.baseUrl ||
    larkConfig.baseURL ||
    larkConfig.openApiBaseUrl ||
    process.env.CODEX_LARK_OPEN_API_BASE_URL ||
    "";
  if (explicitBaseUrl) {
    return {
      key: "custom",
      label: "custom",
      baseUrl: cleanBaseUrl(explicitBaseUrl),
      sdkDomain: cleanBaseUrl(explicitBaseUrl),
    };
  }

  const rawDomain = larkConfig.domain || process.env.CODEX_LARK_DOMAIN || "";
  const normalized = String(rawDomain || "").trim().toLowerCase();
  if (/^https?:\/\//i.test(rawDomain)) {
    return {
      key: "custom",
      label: "custom",
      baseUrl: cleanBaseUrl(rawDomain),
      sdkDomain: cleanBaseUrl(rawDomain),
    };
  }

  const presetKey = LARK_ALIASES.has(normalized)
    ? "lark"
    : FEISHU_ALIASES.has(normalized)
      ? "feishu"
      : "feishu";
  const preset = DOMAIN_PRESETS[presetKey];
  return {
    key: preset.key,
    label: preset.label,
    baseUrl: preset.baseUrl,
    sdkKey: preset.sdkKey,
  };
}

export function larkOpenApiUrl(config = {}, path = "") {
  const baseUrl = larkDomainInfo(config).baseUrl;
  return `${baseUrl}${String(path).startsWith("/") ? path : `/${path}`}`;
}

export function larkSdkDomain(larkSdk, config = {}) {
  const info = larkDomainInfo(config);
  if (info.sdkKey && larkSdk?.Domain?.[info.sdkKey]) return larkSdk.Domain[info.sdkKey];
  return info.sdkDomain || info.baseUrl;
}

export function formatLarkDomain(config = {}) {
  const info = larkDomainInfo(config);
  return `${info.label} (${info.baseUrl})`;
}

function cleanBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}
