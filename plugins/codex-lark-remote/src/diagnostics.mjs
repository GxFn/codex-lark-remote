import fs from "node:fs/promises";
import { loadConfig } from "./config.mjs";
import { larkWebSocketEnabled } from "./lark-ws.mjs";
import { configuredAllowedUsers } from "./lark.mjs";
import { LarkNotifier } from "./notifier.mjs";
import { bridgeStatus } from "./supervisor.mjs";

export async function diagnoseLarkRemote(options = {}) {
  const config = await loadConfig(options);
  const status = await bridgeStatus(options);
  const publicUrl = cleanPublicUrl(process.env.CODEX_LARK_PUBLIC_URL || config.publicUrl || "");
  const webhookUrl = publicUrl ? joinUrl(publicUrl, "/bridge/lark/event") : "";
  const webSocketEnabled = larkWebSocketEnabled(config);
  const allowedUsers = configuredAllowedUsers(config);
  const repos = await repoDiagnostics(config);
  const auth = options.checkAuth ? await new LarkNotifier(config.lark || {}).checkAuth() : null;

  const issues = [];
  const warnings = [];
  if (!status.running) issues.push("Bridge is not running. Start it with codex_lark_start.");
  if (!webSocketEnabled && !publicUrl) warnings.push("No publicUrl/CODEX_LARK_PUBLIC_URL is configured; Feishu cannot reach a loopback URL directly.");
  if (!config.lark?.appId || !config.lark?.appSecret) issues.push("Lark appId/appSecret are not configured.");
  if (webSocketEnabled && status.data?.larkWs?.lastError) warnings.push(status.data.larkWs.lastError);
  if (!config.lark?.verificationToken && !process.env.CODEX_LARK_VERIFICATION_TOKEN) {
    warnings.push(webSocketEnabled ? "Verification token is only needed for webhook fallback." : "Verification token is not configured.");
  }
  if (!config.lark?.encryptKey && !process.env.CODEX_LARK_ENCRYPT_KEY) {
    warnings.push(webSocketEnabled ? "Encrypt key is only needed for signed/encrypted webhook fallback." : "Encrypt key is not configured; signed/encrypted webhook verification is recommended.");
  }
  if (allowedUsers.length === 0) warnings.push("No allowedUsers allowlist is configured.");
  if (!Object.keys(config.repos || {}).length) issues.push("No repos are configured.");
  if (config.defaultRepo && !config.repos?.[config.defaultRepo]) issues.push(`defaultRepo is not defined in repos: ${config.defaultRepo}`);
  for (const repo of repos) {
    if (!repo.pathExists) issues.push(`Repo path does not exist: ${repo.key}`);
  }
  if (auth && !auth.ok) issues.push(auth.message || "Lark auth check failed.");

  return {
    ok: issues.length === 0,
    checks: {
      bridgeRunning: Boolean(status.running),
      webSocketEnabled,
      webSocketConnected: Boolean(status.data?.larkWs?.connected),
      publicUrlConfigured: Boolean(publicUrl),
      appCredentialsConfigured: Boolean(config.lark?.appId && config.lark?.appSecret),
      verificationTokenConfigured: Boolean(config.lark?.verificationToken || process.env.CODEX_LARK_VERIFICATION_TOKEN),
      encryptKeyConfigured: Boolean(config.lark?.encryptKey || process.env.CODEX_LARK_ENCRYPT_KEY),
      allowedUsersConfigured: allowedUsers.length > 0,
      reposConfigured: Object.keys(config.repos || {}).length > 0,
    },
    bridge: {
      localUrl: status.state?.url || "",
      publicUrl,
      webhookUrl,
      route: "/bridge/lark/event",
      larkWs: status.data?.larkWs || null,
    },
    lark: {
      transport: config.lark?.transport || "websocket",
      appIdPrefix: config.lark?.appId ? `${config.lark.appId.slice(0, 8)}...` : "",
      appSecretConfigured: Boolean(config.lark?.appSecret),
      verificationTokenConfigured: Boolean(config.lark?.verificationToken || process.env.CODEX_LARK_VERIFICATION_TOKEN),
      encryptKeyConfigured: Boolean(config.lark?.encryptKey || process.env.CODEX_LARK_ENCRYPT_KEY),
      allowedUsersCount: allowedUsers.length,
      auth,
    },
    repos,
    issues,
    warnings,
    nextActions: buildNextActions({ status, webhookUrl, publicUrl, webSocketEnabled }),
  };
}

export function formatDiagnostics(diagnostics) {
  return [
    "Codex Lark Remote diagnostics",
    `Ready: ${diagnostics.ok ? "yes" : "no"}`,
    `Bridge: ${diagnostics.checks.bridgeRunning ? "running" : "stopped"}`,
    `Lark transport: ${formatTransport(diagnostics)}`,
    `Local URL: ${diagnostics.bridge.localUrl || "-"}`,
    diagnostics.checks.webSocketEnabled ? "" : `Webhook URL: ${diagnostics.bridge.webhookUrl || "-"}`,
    `Lark app: ${diagnostics.lark.appIdPrefix || "-"}`,
    `Allowed users: ${diagnostics.lark.allowedUsersCount || 0}`,
    `Repos: ${diagnostics.repos.map((repo) => `${repo.key}${repo.pathExists ? "" : " (missing)"}`).join(", ") || "none"}`,
    diagnostics.issues.length ? `Issues:\n${diagnostics.issues.map((item) => `- ${item}`).join("\n")}` : "Issues: none",
    diagnostics.warnings.length ? `Warnings:\n${diagnostics.warnings.map((item) => `- ${item}`).join("\n")}` : "Warnings: none",
    diagnostics.nextActions.length ? `Next actions:\n${diagnostics.nextActions.map((item) => `- ${item}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatHandoff(diagnostics) {
  return [
    "Codex Lark Remote handoff",
    diagnostics.ok ? "Status: ready" : "Status: needs attention",
    `Transport: ${formatTransport(diagnostics)}`,
    diagnostics.checks.webSocketEnabled
      ? "Feishu setup: Event Subscriptions -> long connection -> im.message.receive_v1"
      : `Feishu setup: webhook URL ${diagnostics.bridge.webhookUrl || "-"}`,
    "",
    "From Feishu:",
    "[repo] describe the coding task",
    "/codex status",
    "/codex approve <task_id> commit",
    diagnostics.issues.length ? `\nIssues:\n${diagnostics.issues.map((item) => `- ${item}`).join("\n")}` : "",
    diagnostics.warnings.length ? `\nWarnings:\n${diagnostics.warnings.map((item) => `- ${item}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function repoDiagnostics(config) {
  return Promise.all(
    Object.entries(config.repos || {}).map(async ([key, repo]) => ({
      key,
      pathConfigured: Boolean(repo.path),
      pathExists: repo.path ? await pathExists(repo.path) : false,
      remote: repo.remote || "",
      baseBranch: repo.baseBranch || "",
      testCommandConfigured: Boolean(repo.testCommand),
      isDefault: config.defaultRepo === key,
    })),
  );
}

async function pathExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function buildNextActions({ status, webhookUrl, publicUrl, webSocketEnabled }) {
  const actions = [];
  if (!status.running) actions.push("Run codex_lark_start.");
  if (webSocketEnabled) {
    actions.push("In Feishu Event Subscriptions, choose long connection and add im.message.receive_v1.");
    actions.push("Send [repo] ping from Feishu after WebSocket is connected.");
  } else {
    if (!publicUrl) actions.push("Expose the local bridge with a trusted tunnel/reverse proxy and set CODEX_LARK_PUBLIC_URL.");
    if (webhookUrl) actions.push(`Set Feishu Event Subscription request URL to ${webhookUrl}.`);
    actions.push("Use npm run fixture -- --sign --encrypt --challenge before configuring Feishu.");
    actions.push("Send [repo] ping from Feishu after URL verification succeeds.");
  }
  return actions;
}

function formatTransport(diagnostics) {
  if (!diagnostics.checks.webSocketEnabled) return "webhook";
  const larkWs = diagnostics.bridge.larkWs;
  if (larkWs?.connected) return "websocket connected";
  if (larkWs?.starting) return "websocket connecting";
  return `websocket ${larkWs?.message || "not connected"}`;
}

function cleanPublicUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function joinUrl(base, route) {
  return `${cleanPublicUrl(base)}${route.startsWith("/") ? route : `/${route}`}`;
}
