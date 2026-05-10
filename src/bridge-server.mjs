import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { DEFAULT_BRIDGE_HOST, ensureDir, loadConfig, nowIso, stateFilePath } from "./config.mjs";
import { runApprovedAction } from "./actions.mjs";
import { decryptLarkPayload, verifyLarkSignature } from "./crypto.mjs";
import { parseLarkEvent, isUserAllowed, classifyChatText } from "./lark.mjs";
import { LarkNotifier } from "./notifier.mjs";
import { formatBridgeStatus, formatHelp, formatQueued, formatTask } from "./presenter.mjs";
import { RemoteCommandQueue } from "./queue.mjs";
import { CodexCliRunner } from "./runner.mjs";

export async function startBridge(options = {}) {
  const config = await loadConfig({ dataDir: options.dataDir, configPath: options.configPath });
  const queue = new RemoteCommandQueue({ dataDir: config.dataDir });
  const notifier = new LarkNotifier(config.lark || {});
  const runner = new CodexCliRunner({ queue, config, notifier });
  const token = options.token || process.env.CODEX_LARK_BRIDGE_TOKEN || crypto.randomBytes(24).toString("hex");
  const host = options.host || DEFAULT_BRIDGE_HOST;
  const port = Number(options.port ?? 0);

  const server = http.createServer(async (req, res) => {
    try {
      await route({ req, res, config, queue, notifier, runner, token, server });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error.message });
    }
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const url = `http://${host}:${address.port}`;
  await writeState(config.dataDir, { pid: process.pid, host, port: address.port, url, token, startedAt: nowIso() });

  if (config.runner?.workerEnabled !== false) {
    setInterval(() => runner.processAll().catch(() => {}), 2000).unref();
  }

  return { server, config, queue, runner, url, token };
}

async function route(ctx) {
  const { req, res, token } = ctx;
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "POST" && url.pathname === "/bridge/lark/event") {
    const { body, raw } = await readJson(req);
    return handleLarkEvent(ctx, body, raw, req.headers);
  }

  if (url.pathname.startsWith("/bridge/") && !isAuthorized(req, token)) {
    return sendJson(res, 401, { success: false, error: "Unauthorized" });
  }

  if (req.method === "GET" && ["/bridge/status", "/bridge/lark/status"].includes(url.pathname)) {
    const counts = await ctx.queue.counts();
    return sendJson(res, 200, {
      success: true,
      data: {
        url: publicUrl(ctx.config),
        counts,
        workerBusy: ctx.runner.busy,
        repos: Object.keys(ctx.config.repos || {}),
        text: formatBridgeStatus({ config: ctx.config, counts, workerBusy: ctx.runner.busy, url: publicUrl(ctx.config) }),
      },
    });
  }

  if (req.method === "POST" && ["/bridge/stop", "/bridge/lark/stop"].includes(url.pathname)) {
    sendJson(res, 200, { success: true, message: "Stopping bridge" });
    setTimeout(() => ctx.server.close(() => process.exit(0)), 50).unref();
    return;
  }

  if (req.method === "POST" && url.pathname === "/bridge/lark/start") {
    return sendJson(res, 200, { success: true, message: "Bridge already running" });
  }

  if (req.method === "GET" && url.pathname === "/bridge/tasks") {
    const limit = Number(url.searchParams.get("limit") || 20);
    return sendJson(res, 200, { success: true, data: await ctx.queue.list({ limit }) });
  }

  if (req.method === "POST" && url.pathname === "/bridge/tasks") {
    const { body } = await readJson(req);
    const created = await enqueueTask(ctx, {
      repoKey: body.repoKey || ctx.config.defaultRepo,
      text: body.prompt || body.text || "",
      messageId: "",
      chatIdHash: "",
      userIdHash: "manual",
      userName: "developer",
    });
    ctx.runner.processAll().catch(() => {});
    return sendJson(res, 200, { success: true, data: created });
  }

  const taskMatch = url.pathname.match(/^\/bridge\/tasks\/([^/]+)(?:\/([^/]+))?$/);
  if (taskMatch) {
    const [, id, action] = taskMatch;
    if (req.method === "GET" && !action) return sendJson(res, 200, { success: true, data: await ctx.queue.get(id) });
    if (req.method === "POST" && action === "cancel") {
      return sendJson(res, 200, { success: true, data: await ctx.queue.cancel(id) });
    }
    if (req.method === "POST" && action === "approve") {
      const { body } = await readJson(req);
      return sendJson(res, 200, {
        success: true,
        data: await runApprovedAction({
          queue: ctx.queue,
          config: ctx.config,
          commandId: id,
          action: body.action || "review",
        }),
      });
    }
  }

  return sendJson(res, 404, { success: false, error: "Not found" });
}

async function handleLarkEvent(ctx, incomingBody, rawBody, headers) {
  const signature = verifyLarkSignature({
    rawBody,
    headers,
    encryptKey: ctx.config.lark?.encryptKey || process.env.CODEX_LARK_ENCRYPT_KEY || "",
  });
  if (signature.checked && !signature.ok) {
    return sendJson(ctx.res, 401, { success: false, error: signature.reason || "Invalid Lark signature" });
  }

  const body = normalizeLarkBody(incomingBody, ctx.config);
  const token = ctx.config.lark?.verificationToken || process.env.CODEX_LARK_VERIFICATION_TOKEN || "";
  const headerToken = body?.header?.token || body?.token || "";
  if (token && headerToken !== token) {
    return sendJson(ctx.res, 403, { success: false, error: "Invalid verification token" });
  }

  const event = parseLarkEvent(body);
  if (event.kind === "url_verification") return sendJson(ctx.res, 200, { challenge: event.challenge });
  if (event.kind !== "message") return sendJson(ctx.res, 200, { success: true });

  if (!isUserAllowed(event.senderId)) {
    await ctx.notifier.reply(event.messageId, "Permission denied.");
    return sendJson(ctx.res, 200, { success: true });
  }
  if (event.messageType && event.messageType !== "text") {
    await ctx.notifier.reply(event.messageId, "Please send a text message.");
    return sendJson(ctx.res, 200, { success: true });
  }
  if (!event.text) return sendJson(ctx.res, 200, { success: true });

  const duplicate = await ctx.queue.findByMessageId(event.messageId);
  if (duplicate) return sendJson(ctx.res, 200, { success: true, duplicate: true });

  const action = classifyChatText(event.text, ctx.config);
  await handleChatAction(ctx, event, action);
  return sendJson(ctx.res, 200, { success: true });
}

async function handleChatAction(ctx, event, action) {
  if (action.kind === "help") return ctx.notifier.reply(event.messageId, formatHelp());
  if (action.kind === "status") {
    const counts = await ctx.queue.counts();
    return ctx.notifier.reply(
      event.messageId,
      formatBridgeStatus({ config: ctx.config, counts, workerBusy: ctx.runner.busy, url: publicUrl(ctx.config) }),
    );
  }
  if (action.kind === "task_status" || action.kind === "task_diff") {
    return ctx.notifier.reply(event.messageId, formatTask(await ctx.queue.get(action.id)));
  }
  if (action.kind === "cancel") {
    return ctx.notifier.reply(event.messageId, formatTask(await ctx.queue.cancel(action.id)));
  }
  if (action.kind === "approve") {
    try {
      return ctx.notifier.reply(
        event.messageId,
        formatTask(
          await runApprovedAction({
            queue: ctx.queue,
            config: ctx.config,
            commandId: action.id,
            action: action.action,
          }),
        ),
      );
    } catch (error) {
      return ctx.notifier.reply(event.messageId, `Approval failed: ${error.message}`);
    }
  }
  if (action.kind === "rejected") return ctx.notifier.reply(event.messageId, action.reason);
  if (action.kind !== "task") return;

  const created = await enqueueTask(ctx, {
    repoKey: action.repoKey,
    text: action.taskText,
    messageId: event.messageId,
    chatIdHash: event.chatIdHash,
    userIdHash: event.userIdHash,
    userName: event.senderName,
  });
  await ctx.notifier.reply(event.messageId, formatQueued(created));
  ctx.runner.processAll().catch(() => {});
}

async function enqueueTask(ctx, input) {
  const repo = ctx.config.repos?.[input.repoKey];
  if (!repo?.path) throw new Error(`Repo is not configured: ${input.repoKey}`);
  return ctx.queue.enqueue({
    source: "lark",
    repoKey: input.repoKey,
    projectRoot: repo.path,
    prompt: input.text,
    normalizedTask: input.text,
    messageId: input.messageId,
    chatIdHash: input.chatIdHash,
    userIdHash: input.userIdHash,
    userName: input.userName,
  });
}

function isAuthorized(req, token) {
  const header = req.headers.authorization || "";
  return header === `Bearer ${token}`;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = chunks.length === 0 ? "" : Buffer.concat(chunks).toString("utf8");
  return { body: raw ? JSON.parse(raw) : {}, raw };
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(`${JSON.stringify(body)}\n`);
}

async function writeState(dataDir, state) {
  await ensureDir(dataDir);
  await fs.writeFile(stateFilePath(dataDir), `${JSON.stringify(state, null, 2)}\n`);
}

function publicUrl(config) {
  return process.env.CODEX_LARK_PUBLIC_URL || config.publicUrl || "";
}

function normalizeLarkBody(body, config) {
  if (body?.encrypt) {
    return decryptLarkPayload(body.encrypt, config.lark?.encryptKey || process.env.CODEX_LARK_ENCRYPT_KEY || "");
  }
  return body;
}
