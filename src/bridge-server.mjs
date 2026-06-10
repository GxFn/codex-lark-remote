import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { DEFAULT_BRIDGE_HOST, configFilePath, ensureDir, loadConfig, nowIso, readPackageVersion, stateFilePath } from "./config.mjs";
import { runApprovedAction } from "./actions.mjs";
import { decryptLarkPayload, verifyLarkSignature } from "./crypto.mjs";
import { updateRuntimeConfig } from "./config-writer.mjs";
import { isBridgeStopText, parseControlSemanticAction } from "./control-semantics.mjs";
import { activateHandoff, clearHandoff, readHandoff } from "./handoff.mjs";
import { routeChatTextAction } from "./intent-router.mjs";
import {
  detectIntentLanguage,
  resolveIntentSessionLanguage,
  setIntentSessionLanguage,
  setIntentSessionMode,
} from "./intent-state.mjs";
import { KeepAwakeController } from "./keep-awake.mjs";
import { LarkWebSocketReceiver } from "./lark-ws.mjs";
import { parseLarkEvent, isUserAllowed, classifyChatText, configuredAllowedUsers } from "./lark.mjs";
import { LarkNotifier } from "./notifier.mjs";
import {
  buildConsoleModeCard,
  buildBridgeStopConfirmCard,
  buildBridgeStatusCard,
  buildHandoffDisabledCard,
  buildSetupVerificationCard,
  buildTakeoverConfirmCard,
  buildTakeoverListCard,
  buildTakeoverProjectListCard,
  buildTakeoverSelectedCard,
  formatBridgeStatus,
  formatBridgeStopCancelled,
  formatBridgeStopConfirm,
  formatBridgeStopping,
  formatConsoleModeIntro,
  formatGuidanceQueued,
  formatHelp,
  formatHandoffModeEnabled,
  formatHandoffModeUnavailable,
  formatHandoffDisabled,
  formatHandoffSessionBusy,
  formatObservationList,
  formatObservationStatus,
  formatPendingTakeoverInputDiscarded,
  formatQueued,
  formatSetupVerification,
  formatTask,
  formatTakeoverActive,
  formatTakeoverPreparationCancelled,
  formatTakeoverPreparationNotActive,
  formatTakeoverList,
  formatTakeoverPending,
  formatTakeoverProjectList,
  formatTakeoverSelected,
  formatTakeoverStatus,
  formatTakeoverTimedOut,
  formatWhoami,
} from "./presenter.mjs";
import { RemoteCommandQueue } from "./queue.mjs";
import { CodexCliRunner, readSessionLastTurnSummary } from "./runner.mjs";
import { activateObservation, clearObservation, CodexSessionObserver, listObservationTargets, readObservation, updateObservationMessageId } from "./observer.mjs";
import { assertLarkAppCredentials } from "./setup-guide.mjs";
import { buildLarkSetupVerificationReport } from "./setup-verification.mjs";
import { sendStartupIntroIfNeeded } from "./startup-notice.mjs";
import {
  activatePendingTakeoverIfIdle,
  clearPendingTakeoverInputs,
  clearTakeover,
  detectSessionStatus,
  executeTakeoverTarget,
  listTakeoverProjects,
  listTakeoverTargets,
  prepareTakeoverScope,
  readTakeover,
  refreshTakeoverProjectSelection,
  refreshTakeoverSelection,
  selectTakeoverProject,
  selectTakeoverTarget,
  setTakeoverProjectPage,
  setTakeoverSelectionPage,
} from "./takeover.mjs";

const TAKEOVER_DISPLAY_PAGE_SIZE = 3;

export async function startBridge(options = {}) {
  const config = await loadConfig({ dataDir: options.dataDir, configPath: options.configPath });
  assertLarkAppCredentials(config);
  const queue = new RemoteCommandQueue({ dataDir: config.dataDir });
  const notifier = new LarkNotifier(config.lark || {});
  const runner = new CodexCliRunner({ queue, config, notifier });
  const logger = options.logger || console;
  const keepAwake = new KeepAwakeController({ config, logger });
  const observer = new CodexSessionObserver({ config, notifier, logger });
  const bridge = {
    config,
    queue,
    notifier,
    runner,
    observer,
    token: null,
    server: null,
    larkWs: null,
    logger,
    keepAwake,
    takeoverTimer: null,
    takeoverBusy: false,
    seenMessageIds: new Map(),
  };
  const cleanup = () => {
    bridge.larkWs?.stop();
    bridge.observer?.stop();
    bridge.keepAwake?.stop();
    if (bridge.takeoverTimer) clearInterval(bridge.takeoverTimer);
  };
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.once("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  const version = await readPackageVersion();
  const token = options.token || process.env.CODEX_LARK_BRIDGE_TOKEN || crypto.randomBytes(24).toString("hex");
  bridge.token = token;
  const host = options.host || DEFAULT_BRIDGE_HOST;
  const port = Number(options.port ?? 0);

  const server = http.createServer(async (req, res) => {
    try {
      await route({ ...bridge, req, res });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error.message });
    }
  });
  bridge.server = server;
  bridge.larkWs = new LarkWebSocketReceiver({
    config,
    onEvent: (eventBody) => processLarkEvent(bridge, eventBody),
    logger,
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const url = `http://${host}:${address.port}`;
  await writeState(config.dataDir, { pid: process.pid, version, host, port: address.port, url, token, startedAt: nowIso() });
  await bridge.larkWs.start();
  await maybeSendStartupIntro(bridge, { reason: "bridge_start" });
  const activeHandoff = await readHandoff({ dataDir: config.dataDir });
  if (activeHandoff) {
    bridge.keepAwake.start();
  } else {
    await cancelInactiveHandoffTasks(bridge);
  }
  await bridge.observer.restore();

  if (config.runner?.workerEnabled !== false) {
    setInterval(() => runner.processAll().catch(() => {}), 2000).unref();
  }
  if (config.takeover?.enabled !== false) {
    bridge.takeoverTimer = setInterval(
      () => processPendingTakeover(bridge).catch((error) => logger.warn?.(`[codex-lark-remote] takeover watcher failed: ${error.message}`)),
      Number(config.takeover?.pollIntervalMs || 1000),
    );
    bridge.takeoverTimer.unref?.();
  }

  return { ...bridge, url, token };
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
        version: await readPackageVersion(),
        counts,
        workerBusy: ctx.runner.busy,
        handoff: await readHandoff({ dataDir: ctx.config.dataDir }),
        observation: await readObservation({ dataDir: ctx.config.dataDir }),
        takeover: await readTakeover({ dataDir: ctx.config.dataDir }),
        observer: ctx.observer?.status(),
        keepAwake: ctx.keepAwake?.status(),
        larkWs: ctx.larkWs?.status(),
        repos: Object.keys(ctx.config.repos || {}),
        text: formatBridgeStatus({
          config: ctx.config,
          counts,
          workerBusy: ctx.runner.busy,
          handoff: await readHandoff({ dataDir: ctx.config.dataDir }),
          observation: await readObservation({ dataDir: ctx.config.dataDir }),
          takeover: await readTakeover({ dataDir: ctx.config.dataDir }),
          keepAwake: ctx.keepAwake?.status(),
          larkWs: ctx.larkWs?.status(),
          url: publicUrl(ctx.config),
        }),
      },
    });
  }

  if (req.method === "POST" && ["/bridge/stop", "/bridge/lark/stop"].includes(url.pathname)) {
    const { body } = await readJson(req);
    const stopped = await stopBridgeForLocalRequest(ctx, body);
    sendJson(res, 200, stopped);
    stopBridgeSoon(ctx);
    return;
  }

  if (req.method === "POST" && url.pathname === "/bridge/lark/start") {
    const data = await ctx.larkWs?.start();
    const startupNotice = await maybeSendStartupIntro(ctx, { reason: "lark_start" });
    return sendJson(res, 200, { success: true, data, startupNotice, message: "Bridge already running" });
  }

  if (req.method === "POST" && url.pathname === "/bridge/lark/card-action") {
    const { body } = await readJson(req);
    return sendJson(res, 200, await processLarkEvent(ctx, {
      ...body,
      header: { ...(body.header || {}), event_type: "card.action.trigger" },
    }));
  }

  if (req.method === "GET" && url.pathname === "/bridge/tasks") {
    const limit = Number(url.searchParams.get("limit") || 20);
    return sendJson(res, 200, { success: true, data: await ctx.queue.list({ limit }) });
  }

  if (req.method === "GET" && url.pathname === "/bridge/setup/verify") {
    const report = await buildSetupVerificationFromBridge(ctx);
    return sendJson(res, 200, {
      success: true,
      data: report,
      text: formatSetupVerification(report, { language: "zh" }),
    });
  }

  if (req.method === "POST" && url.pathname === "/bridge/commands/visibility") {
    const { body } = await readJson(req);
    const updated = await setCommandVisibilityForBridge(ctx, body);
    return sendJson(res, 200, updated);
  }

  if (req.method === "GET" && url.pathname === "/bridge/handoff") {
    return sendJson(res, 200, { success: true, data: await readHandoff({ dataDir: ctx.config.dataDir }) });
  }

  if (req.method === "POST" && url.pathname === "/bridge/handoff") {
    const { body } = await readJson(req);
    const data = await activateHandoff({
      dataDir: ctx.config.dataDir,
      threadId: body.threadId,
      threadPath: body.threadPath,
      cwd: body.cwd,
      name: body.name,
      requireExplicitThread: body.requireExplicitThread !== false,
      activatedBy: body.activatedBy || "bridge",
    });
    const keepAwake = ctx.keepAwake?.start();
    const startupNotice = await maybeSendStartupIntro(ctx, { reason: "handoff" });
    return sendJson(res, 200, { success: true, data, keepAwake, startupNotice });
  }

  if (req.method === "POST" && url.pathname === "/bridge/dispatch/prepare") {
    const { body } = await readJson(req);
    const prepared = await prepareDispatchCommand(ctx, body.remoteCommandId || body.commandId || body.id);
    return sendJson(res, prepared.success ? 200 : 404, prepared);
  }

  if (req.method === "POST" && url.pathname === "/bridge/remote-command/route") {
    const { body } = await readJson(req);
    const routed = await routeRemoteCommand(ctx, body.remoteCommandId || body.commandId || body.id);
    return sendJson(res, routed.success ? 200 : 404, routed);
  }

  if (req.method === "POST" && url.pathname === "/bridge/dispatch/record") {
    const { body } = await readJson(req);
    const recorded = await recordDispatchCommand(ctx, body);
    return sendJson(res, recorded.success ? 200 : 400, recorded);
  }

  if (req.method === "POST" && url.pathname === "/bridge/dispatch/execute") {
    const { body } = await readJson(req);
    const dispatched = await dispatchRemoteCommand(ctx, body);
    return sendJson(res, dispatched.success ? 200 : 400, dispatched);
  }

  if (req.method === "POST" && url.pathname === "/bridge/dispatch/clarify") {
    const { body } = await readJson(req);
    const clarified = await requestDispatchClarification(ctx, body);
    return sendJson(res, clarified.success ? 200 : 400, clarified);
  }

  if (req.method === "POST" && url.pathname === "/bridge/remote-command/reply") {
    const { body } = await readJson(req);
    const replied = await replyRemoteCommand(ctx, body);
    return sendJson(res, replied.success ? 200 : 400, replied);
  }

  if (req.method === "DELETE" && url.pathname === "/bridge/handoff") {
    const data = await clearHandoff({ dataDir: ctx.config.dataDir });
    const cleared = await clearTakeover({ dataDir: ctx.config.dataDir });
    await stopPendingTakeoverObservation(ctx, cleared?.previous);
    const keepAwake = ctx.keepAwake?.stop();
    return sendJson(res, 200, { success: true, data, keepAwake });
  }

  if (req.method === "GET" && url.pathname === "/bridge/takeover") {
    return sendJson(res, 200, { success: true, data: await readTakeover({ dataDir: ctx.config.dataDir }) });
  }

  if (req.method === "GET" && url.pathname === "/bridge/observation/targets") {
    const limit = Number(url.searchParams.get("limit") || 10);
    const cwd = url.searchParams.get("cwd") || "";
    const targets = await listObservationTargets({ cwd, limit });
    const observation = await readObservation({ dataDir: ctx.config.dataDir });
    return sendJson(res, 200, {
      success: true,
      data: { targets, observation },
      text: formatObservationList(targets, observation),
    });
  }

  if (req.method === "POST" && url.pathname === "/bridge/observation/start") {
    const { body } = await readJson(req);
    const command = body.commandId && typeof ctx.queue.get === "function" ? await ctx.queue.get(body.commandId).catch(() => null) : null;
    const observation = await activateObservation({
      dataDir: ctx.config.dataDir,
      selector: body.selector || body.threadId,
      threadId: body.threadId,
      cwd: body.cwd || command?.projectRoot || "",
      messageId: body.messageId || command?.messageId || "",
      chatIdHash: body.chatIdHash || command?.chatIdHash || "",
      userIdHash: body.userIdHash || command?.userIdHash || "",
      language: body.language || "",
      activatedBy: body.activatedBy || "mcp",
    });
    let delivered = { observation, delivery: null };
    if (observation.messageId) {
      delivered = await deliverObservationStatus(
        ctx,
        { messageId: observation.messageId, chatIdHash: observation.chatIdHash, userIdHash: observation.userIdHash },
        observation,
        { language: observation.language || body.language || "zh" },
      );
    }
    await ctx.observer?.start(delivered.observation);
    return sendJson(res, 200, {
      success: true,
      data: delivered.observation,
      text: observation.messageId
        ? formatObservationStatus(delivered.observation, { language: observation.language || body.language || "zh" })
        : `${formatObservationStatus(delivered.observation, { language: observation.language || body.language || "zh" })}\n\nNo Feishu/Lark message id was provided, so streaming may not be anchored to a chat reply.`,
    });
  }

  if (req.method === "DELETE" && url.pathname === "/bridge/observation") {
    const data = await clearObservation({ dataDir: ctx.config.dataDir });
    await ctx.observer?.stop();
    return sendJson(res, 200, { success: true, data, text: formatObservationStatus(data) });
  }

  if (req.method === "GET" && url.pathname === "/bridge/takeover/projects") {
    const limit = Number(url.searchParams.get("limit") || ctx.config.takeover?.projectLimit || 20);
    const page = Number(url.searchParams.get("page") || 0);
    const pageSize = Number(url.searchParams.get("pageSize") || TAKEOVER_DISPLAY_PAGE_SIZE);
    const refreshed = await refreshTakeoverProjectSelection({
      dataDir: ctx.config.dataDir,
      limit,
      page,
      pageSize,
      idleDebounceMs: ctx.config.takeover?.idleDebounceMs,
      selectionTtlMs: ctx.config.takeover?.selectionTtlMs,
    });
    return sendJson(res, 200, {
      success: true,
      data: refreshed,
      text: formatTakeoverProjectList(refreshed.projects, {
        page: refreshed.state.projectSelection?.page || 0,
        pageSize: refreshed.state.projectSelection?.pageSize || TAKEOVER_DISPLAY_PAGE_SIZE,
      }),
    });
  }

  if (req.method === "POST" && url.pathname === "/bridge/takeover/scope") {
    const { body } = await readJson(req);
    const data = await prepareTakeoverScope({
      dataDir: ctx.config.dataDir,
      cwd: body.cwd,
      threadId: body.threadId,
      threadPath: body.threadPath,
      startedBy: body.startedBy || "bridge",
    });
    return sendJson(res, 200, { success: true, data, text: formatTakeoverStatus(data) });
  }

  if (req.method === "POST" && url.pathname === "/bridge/takeover/project/select") {
    const { body } = await readJson(req);
    const selected = await selectTakeoverProject({
      dataDir: ctx.config.dataDir,
      selector: body.selector,
      projectIndex: body.projectIndex,
      cwd: body.cwd,
      limit: Number(body.limit || 10),
      pageSize: Number(body.pageSize || TAKEOVER_DISPLAY_PAGE_SIZE),
      idleDebounceMs: ctx.config.takeover?.idleDebounceMs,
      selectionTtlMs: ctx.config.takeover?.selectionTtlMs,
    });
    return sendJson(res, 200, {
      success: true,
      data: selected,
      text: formatTakeoverList(selected.targets, {
        cwd: selected.project?.cwd || body.cwd || "",
        page: selected.state.selection?.page || 0,
        pageSize: selected.state.selection?.pageSize || TAKEOVER_DISPLAY_PAGE_SIZE,
      }),
    });
  }

  if (req.method === "GET" && url.pathname === "/bridge/takeover/targets") {
    const limit = Number(url.searchParams.get("limit") || 10);
    const cwd = url.searchParams.get("cwd") || "";
    const refreshed = await refreshTakeoverSelection({
      dataDir: ctx.config.dataDir,
      cwd,
      limit,
      idleDebounceMs: ctx.config.takeover?.idleDebounceMs,
      selectionTtlMs: ctx.config.takeover?.selectionTtlMs,
    });
    return sendJson(res, 200, {
      success: true,
      data: refreshed,
      text: formatTakeoverList(refreshed.targets, { cwd: cwd || refreshed.state?.scope?.cwd || "" }),
    });
  }

  if (req.method === "POST" && url.pathname === "/bridge/takeover/select") {
    const { body } = await readJson(req);
    const selected = await selectTakeoverTarget({
      dataDir: ctx.config.dataDir,
      selector: body.selector,
      optionIndex: body.optionIndex,
      threadId: body.threadId,
      messageId: body.messageId,
      chatIdHash: body.chatIdHash,
      userIdHash: body.userIdHash,
      idleDebounceMs: ctx.config.takeover?.idleDebounceMs,
    });
    return sendJson(res, 200, { success: true, data: selected, text: formatTakeoverSelected(selected.target) });
  }

  if (req.method === "POST" && url.pathname === "/bridge/takeover/execute") {
    const { body } = await readJson(req);
    const executed = await executeTakeoverForBridge(ctx, {
      selector: body.selector,
      optionIndex: body.optionIndex,
      threadId: body.threadId,
      messageId: body.messageId,
      chatIdHash: body.chatIdHash,
      userIdHash: body.userIdHash,
    });
    return sendJson(res, 200, { success: true, data: executed, text: formatTakeoverExecution(executed) });
  }

  if (req.method === "POST" && url.pathname === "/bridge/takeover/input") {
    await readJson(req);
    const data = await readTakeover({ dataDir: ctx.config.dataDir });
    return sendJson(res, 409, {
      success: false,
      data,
      text: formatPendingTakeoverInputDiscarded(data),
    });
  }

  if (req.method === "POST" && url.pathname === "/bridge/takeover/exit") {
    const { body } = await readJson(req);
    const exited = await exitTakeoverForBridge(ctx, body);
    return sendJson(res, 200, exited);
  }

  if (req.method === "POST" && url.pathname === "/bridge/takeover/cancel") {
    const { body } = await readJson(req);
    const cancelled = await cancelTakeoverForBridge(ctx, body);
    return sendJson(res, 200, cancelled);
  }

  if (req.method === "DELETE" && url.pathname === "/bridge/takeover") {
    const data = await clearTakeover({ dataDir: ctx.config.dataDir });
    await stopPendingTakeoverObservation(ctx, data?.previous);
    return sendJson(res, 200, { success: true, data, text: formatTakeoverStatus(null) });
  }

  if (req.method === "POST" && url.pathname === "/bridge/tasks") {
    await readJson(req);
    return sendJson(res, 410, {
      success: false,
      error: "Legacy worktree tasks are disabled. Use the Lark Remote control window and target dispatch flow.",
    });
  }

  const taskMatch = url.pathname.match(/^\/bridge\/tasks\/([^/]+)(?:\/([^/]+))?$/);
  if (taskMatch) {
    const [, id, action] = taskMatch;
    if (req.method === "GET" && !action) {
      const task = await ctx.queue.get(id);
      return sendJson(res, 200, { success: true, data: task, text: formatTask(task) });
    }
    if (req.method === "POST" && action === "cancel") {
      const task = await ctx.queue.cancel(id);
      return sendJson(res, 200, { success: true, data: task, text: formatTask(task) });
    }
    if (req.method === "POST" && action === "approve") {
      const { body } = await readJson(req);
      const task = await runApprovedAction({
        queue: ctx.queue,
        config: ctx.config,
        commandId: id,
        action: body.action || "review",
      });
      return sendJson(res, 200, {
        success: true,
        data: task,
        text: formatTask(task),
      });
    }
  }

  return sendJson(res, 404, { success: false, error: "Not found" });
}

async function handleLarkEvent(ctx, incomingBody, rawBody, headers) {
  await refreshBridgeConfig(ctx);
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
  await processLarkEvent(ctx, body);
  return sendJson(ctx.res, 200, { success: true });
}

export async function processLarkEvent(ctx, body) {
  await refreshBridgeConfig(ctx);
  const event = parseLarkEvent(body);
  if (event.kind === "card_action") return processLarkCardAction(ctx, event);
  if (event.kind !== "message") return { success: true, ignored: true };
  if (rememberLarkMessage(ctx, event.messageId)) return { success: true, duplicate: true };

  if (event.messageType && event.messageType !== "text") {
    await ctx.notifier.reply(event.messageId, "Please send a text message.");
    return { success: true, rejected: true };
  }
  if (!event.text) return { success: true, ignored: true };
  await rememberEventLanguage(ctx, event);

  const duplicate = await ctx.queue.findByMessageId(event.messageId);
  if (duplicate) return { success: true, duplicate: true };

  let action = classifyChatText(event.text, ctx.config);
  if (action.kind !== "whoami" && !isUserAllowed(event, ctx.config)) {
    await ctx.notifier.reply(event.messageId, "Permission denied.");
    return { success: true, rejected: true };
  }
  action = isBridgeStopText(event.text) ? { kind: "bridge_stop_confirm" } : await routeChatTextAction(ctx, event, action);
  action = await withTakeoverSelectionContext(ctx, event, action);
  const takeoverAccessError = validateTakeoverAccess(action, event, ctx.config);
  if (takeoverAccessError) {
    await ctx.notifier.reply(event.messageId, takeoverAccessError);
    return { success: true, rejected: true };
  }
  if (action.kind !== "whoami" || isUserAllowed(event, ctx.config)) {
    const handledByAction = action.kind === "intent_console_enable";
    await maybeSendStartupIntro(ctx, {
      event,
      language: await languageForEvent(ctx, event),
      markSentOnly: handledByAction,
      reason: handledByAction ? "first_authorized_console" : "first_authorized_message",
    });
  }
  await handleChatAction(ctx, event, action);
  return { success: true };
}

async function processLarkCardAction(ctx, event) {
  const action = actionFromStartupCard(event);
  if (action) {
    if (action.kind !== "whoami" && !isUserAllowed(event, ctx.config)) {
      await replyMaybe(ctx, event.messageId, "Permission denied.");
      return { success: true, rejected: true };
    }
    const takeoverAccessError = validateTakeoverAccess(action, event, ctx.config);
    if (takeoverAccessError) {
      await replyMaybe(ctx, event.messageId, takeoverAccessError);
      return { success: true, rejected: true };
    }
    const handledByAction = action.kind === "intent_console_enable";
    await maybeSendStartupIntro(ctx, {
      event,
      language: await languageForEvent(ctx, event),
      markSentOnly: handledByAction,
      reason: handledByAction ? "startup_console_card_action" : "startup_card_action",
    });
    await handleChatAction(ctx, event, action);
    return { success: true };
  }

  const takeoverAccessError = validateTakeoverAccess({ kind: "takeover_card" }, event, ctx.config);
  if (takeoverAccessError) {
    await replyMaybe(ctx, event.messageId, takeoverAccessError);
    return { success: true, rejected: true };
  }
  await maybeSendStartupIntro(ctx, { event, language: await languageForEvent(ctx, event), reason: "first_authorized_card_action" });
  await handleCardAction(ctx, event);
  return { success: true };
}

function validateTakeoverAccess(action, event, config) {
  if (!isTakeoverAction(action)) return "";
  const allowed = configuredAllowedUsers(config);
  if (!allowed.length) {
    return [
      "全项目接管需要先配置 lark.allowedUsers。",
      "请在飞书发送 whoami，复制返回的 senderId 或 openId 到配置后再使用会话接管。",
    ].join("\n");
  }
  if (!isUserAllowed(event, config)) return "Permission denied.";
  return "";
}

function isTakeoverAction(action = {}) {
  const kind = String(action.kind || "");
  return kind === "takeover_card" || kind.startsWith("takeover_");
}

function actionFromStartupCard(event) {
  switch (event.value?.action || event.action || "") {
    case "startup_status":
      return { kind: "status" };
    case "setup_verify":
      return { kind: "setup_verify" };
    case "startup_windows":
      return { kind: "takeover_list" };
    case "startup_observe":
      return { kind: "observe_list" };
    case "startup_whoami":
      return { kind: "whoami" };
    case "startup_console":
      return { kind: "intent_console_enable" };
    case "bridge_stop_prompt":
      return { kind: "bridge_stop_confirm" };
    case "bridge_stop_execute":
      return { kind: "bridge_stop_execute" };
    case "bridge_stop_cancel":
      return { kind: "bridge_stop_cancel" };
    default:
      return null;
  }
}

async function handleChatAction(ctx, event, action) {
  const handoff = await readHandoff({ dataDir: ctx.config.dataDir });
  const language = await languageForEvent(ctx, event);
  if (action.kind === "help") return ctx.notifier.reply(event.messageId, formatHelp({ language }));
  if (action.kind === "whoami") return ctx.notifier.reply(event.messageId, formatWhoami(event));
  if (action.kind === "intent_console_enable") {
    await setIntentSessionModeForEvent(ctx, event, "console", "lark");
    return replyCardOrText(ctx, event.messageId, buildConsoleModeCard({ language }), formatConsoleModeIntro({ language }));
  }
  if (action.kind === "intent_handoff_mode") {
    if (!handoff?.active) return ctx.notifier.reply(event.messageId, formatHandoffModeUnavailable({ language }));
    await setIntentSessionModeForEvent(ctx, event, "handoff", "lark");
    return ctx.notifier.reply(event.messageId, formatHandoffModeEnabled(handoff, { language }));
  }
  if (action.kind === "bridge_stop_confirm") {
    return replyCardOrText(ctx, event.messageId, buildBridgeStopConfirmCard({ language }), formatBridgeStopConfirm({ language }));
  }
  if (action.kind === "bridge_stop_cancel") {
    return ctx.notifier.reply(event.messageId, formatBridgeStopCancelled({ language }));
  }
  if (action.kind === "bridge_stop_execute") {
    return handleBridgeStopExecute(ctx, event);
  }
  if (action.kind === "intent_clarify") {
    return ctx.notifier.reply(
      event.messageId,
      [
        action.reason || "我还不确定你想执行哪个操作。",
        language === "en"
          ? "You can say: project list, session list, observe session 1, takeover session 2, or send to current thread: ..."
          : "你可以说：项目列表、会话列表、观察第 1 个会话、接管第 2 个会话，或发送给当前线程：...",
      ].join("\n"),
    );
  }
  if (action.kind === "setup_verify") {
    const report = await buildSetupVerificationFromBridge(ctx);
    return replyCardOrText(ctx, event.messageId, buildSetupVerificationCard(report, { language }), formatSetupVerification(report, { language }));
  }
  if (action.kind === "status") {
    const counts = await ctx.queue.counts();
    const status = {
      config: ctx.config,
      counts,
      workerBusy: ctx.runner.busy,
      handoff,
      observation: await readObservation({ dataDir: ctx.config.dataDir }),
      takeover: await readTakeover({ dataDir: ctx.config.dataDir }),
      keepAwake: ctx.keepAwake?.status(),
      larkWs: ctx.larkWs?.status(),
      url: publicUrl(ctx.config),
    };
    return replyCardOrText(ctx, event.messageId, buildBridgeStatusCard(status, { language }), formatBridgeStatus(status));
  }
  if (action.kind === "handoff_status") {
    return ctx.notifier.reply(event.messageId, formatHandoffStatus(handoff));
  }
  if (action.kind === "command_visibility") {
    return handleCommandVisibility(ctx, event, action);
  }
  if (action.kind === "takeover_list") {
    return handleTakeoverProjectList(ctx, event, action);
  }
  if (action.kind === "takeover_project_select") {
    return handleTakeoverProjectSelect(ctx, event, action);
  }
  if (action.kind === "takeover_window_list") {
    return handleTakeoverWindowList(ctx, event, action);
  }
  if (action.kind === "takeover_select") {
    return handleTakeoverSelect(ctx, event, action);
  }
  if (action.kind === "takeover_confirm") {
    return handleTakeoverConfirm(ctx, event, action);
  }
  if (action.kind === "takeover_observe") {
    return handleTakeoverObserve(ctx, event, action);
  }
  if (action.kind === "takeover_execute") {
    return handleTakeoverExecute(ctx, event, action);
  }
  if (action.kind === "takeover_status") {
    return ctx.notifier.reply(event.messageId, formatTakeoverStatus(await readTakeover({ dataDir: ctx.config.dataDir })));
  }
  if (action.kind === "takeover_disable") {
    return handleTakeoverDisable(ctx, event, { handoff, language });
  }
  if (action.kind === "observe_list") {
    const targets = await listObservationTargets({ cwd: handoff?.cwd || "", limit: 10 });
    return ctx.notifier.reply(
      event.messageId,
      formatObservationList(targets, await readObservation({ dataDir: ctx.config.dataDir }), { language }),
    );
  }
  if (action.kind === "observe_enable") {
    try {
      const observation = await activateObservation({
        dataDir: ctx.config.dataDir,
        selector: action.selector,
        cwd: handoff?.cwd || "",
        messageId: event.messageId,
        chatIdHash: event.chatIdHash,
        userIdHash: event.userIdHash,
        language,
        activatedBy: "lark",
      });
      const delivered = await deliverObservationStatus(ctx, event, observation, { language });
      await ctx.observer?.start(delivered.observation);
      return delivered.delivery;
    } catch (error) {
      const targets = await listObservationTargets({ cwd: handoff?.cwd || "", limit: 10 });
      return ctx.notifier.reply(event.messageId, `${error.message}\n\n${formatObservationList(targets, null, { language })}`);
    }
  }
  if (action.kind === "observe_disable") {
    const observation = await clearObservation({ dataDir: ctx.config.dataDir });
    await ctx.observer?.stop();
    return ctx.notifier.reply(event.messageId, formatObservationStatus(observation, { language }));
  }
  if (action.kind === "handoff_disable") {
    return handleHandoffDisable(ctx, event, { handoff, language });
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
  if (action.kind === "rejected" && !handoff) return ctx.notifier.reply(event.messageId, action.reason);
  if (action.kind === "rejected" && handoff) action = { kind: "task", repoKey: "current", taskText: event.text };
  if (action.kind !== "task") return;

  const takeover = await readTakeover({ dataDir: ctx.config.dataDir });
  if (takeover?.state === "pending" && !handoff?.active) {
    return ctx.notifier.reply(event.messageId, formatPendingTakeoverInputDiscarded(takeover, { language }));
  }

  const runningHandoffCommand = handoff ? await findRunningHandoffTask(ctx, handoff) : null;

  if (!handoff) {
    return ctx.notifier.reply(
      event.messageId,
      language === "en"
        ? "No Lark Remote control window is connected. Start Lark Remote from a trusted Codex conversation, then choose a project/session target."
        : "当前没有已连接的 Lark Remote 控制窗口。请先从可信 Codex 会话启动 Lark Remote，再选择项目/会话目标。",
    );
  }

  const created = await enqueueHandoffTask(ctx, {
        handoff,
        dispatchTarget: ["active", "pending"].includes(takeover?.state || "") ? takeover.target : null,
        takeover,
        text: event.text,
        messageId: event.messageId,
        chatIdHash: event.chatIdHash,
        userIdHash: event.userIdHash,
        userName: event.senderName,
        runningCommand: runningHandoffCommand,
  });
  if (created.handoffGuidance) {
    await ctx.notifier.reply(event.messageId, formatGuidanceQueued(created));
  } else if (created.mode !== "thread_handoff" || created.notifyQueued) {
    await ctx.notifier.reply(event.messageId, formatQueued(created));
  }
  Promise.resolve(ctx.runner.processAll()).catch(() => {});
}

async function handleCommandVisibility(ctx, event, action) {
  if (typeof action.enabled !== "boolean") {
    return ctx.notifier.reply(event.messageId, formatCommandVisibility(ctx.config));
  }
  const updated = await setCommandVisibilityForBridge(ctx, action);
  return ctx.notifier.reply(event.messageId, updated.text);
}

async function handleBridgeStopExecute(ctx, event) {
  const language = await languageForEvent(ctx, event);
  await clearBridgeRuntimeState(ctx);
  await setIntentSessionModeForEvent(ctx, event, "console", "bridge_stopping");
  const result = await ctx.notifier.reply(event.messageId, formatBridgeStopping({ language }));
  stopBridgeSoon(ctx);
  return result;
}

async function setCommandVisibilityForBridge(ctx, action = {}) {
  if (typeof action.enabled === "boolean") {
    await updateRuntimeConfig({
      dataDir: ctx.config.dataDir,
      configPath: ctx.config.configPath,
      handoff: { showCommands: action.enabled },
    });
    ctx.config.handoff = { ...(ctx.config.handoff || {}), showCommands: action.enabled };
  }
  return { success: true, data: { handoff: ctx.config.handoff || {} }, text: formatCommandVisibility(ctx.config) };
}

async function stopBridgeForLocalRequest(ctx, input = {}) {
  const command = await readCommandForBridgeInput(ctx, input);
  const event = eventFromRemoteCommand(command);
  const language = await languageForBridgeInput(ctx, input, command);
  await clearBridgeRuntimeState(ctx);
  if (event.chatIdHash) await setIntentSessionModeForEvent(ctx, event, "console", "bridge_stopping");
  return { success: true, data: { stopped: true }, text: formatBridgeStopping({ language }) };
}

async function clearBridgeRuntimeState(ctx) {
  await clearHandoff({ dataDir: ctx.config.dataDir });
  const cleared = await clearTakeover({ dataDir: ctx.config.dataDir });
  await stopPendingTakeoverObservation(ctx, cleared?.previous);
  await clearObservation({ dataDir: ctx.config.dataDir });
  ctx.observer?.stop();
  ctx.keepAwake?.stop();
  return cleared;
}

async function exitTakeoverForBridge(ctx, input = {}) {
  const command = await readCommandForBridgeInput(ctx, input);
  const event = eventFromRemoteCommand(command);
  const language = await languageForBridgeInput(ctx, input, command);
  const cleared = await clearTakeover({ dataDir: ctx.config.dataDir });
  await stopPendingTakeoverObservation(ctx, cleared?.previous);
  if (event.chatIdHash) await setIntentSessionModeForEvent(ctx, event, "console", "handoff_disabled");
  ctx.keepAwake?.stop();
  return {
    success: true,
    data: { takeover: cleared?.previous || null },
    text: formatHandoffDisabled({ language }),
  };
}

async function cancelTakeoverForBridge(ctx, input = {}) {
  const handoff = await readHandoff({ dataDir: ctx.config.dataDir });
  const takeover = await readTakeover({ dataDir: ctx.config.dataDir });
  if (takeover?.state === "active") return exitTakeoverForBridge(ctx, input);

  const command = await readCommandForBridgeInput(ctx, input);
  const event = eventFromRemoteCommand(command);
  const language = await languageForBridgeInput(ctx, input, command);
  if (!["selecting_project", "selecting", "selected", "pending"].includes(takeover?.state || "")) {
    return {
      success: true,
      data: { takeover: takeover || null, handoff: handoff || null },
      text: formatTakeoverPreparationNotActive({ handoff }, { language }),
    };
  }
  const cleared = await clearTakeover({ dataDir: ctx.config.dataDir });
  await stopPendingTakeoverObservation(ctx, cleared?.previous);
  if (event.chatIdHash) {
    await setIntentSessionModeForEvent(ctx, event, handoff?.active ? "handoff" : "console", "takeover_cancelled");
  }
  return {
    success: true,
    data: { takeover: cleared?.previous || takeover, handoff: handoff || null },
    text: formatTakeoverPreparationCancelled({ takeover: cleared?.previous || takeover, handoff }, { language }),
  };
}

function stopBridgeSoon(ctx) {
  if (typeof ctx.stopBridge === "function") {
    ctx.stopBridge("lark");
    return;
  }
  const timer = setTimeout(() => {
    ctx.larkWs?.stop();
    ctx.observer?.stop();
    ctx.keepAwake?.stop();
    if (ctx.takeoverTimer) clearInterval(ctx.takeoverTimer);
    if (ctx.server?.close) {
      ctx.server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1000).unref?.();
      return;
    }
    process.exit(0);
  }, 100);
  timer.unref?.();
}

async function handleTakeoverProjectList(ctx, event, action = {}) {
  const language = await languageForEvent(ctx, event);
  const refreshed = await refreshTakeoverProjectSelection({
    dataDir: ctx.config.dataDir,
    limit: ctx.config.takeover?.projectLimit || 20,
    page: action.page || 0,
    pageSize: action.pageSize || TAKEOVER_DISPLAY_PAGE_SIZE,
    idleDebounceMs: ctx.config.takeover?.idleDebounceMs,
    selectionTtlMs: ctx.config.takeover?.selectionTtlMs,
  });
  const pageOptions = {
    language,
    page: refreshed.state.projectSelection?.page || 0,
    pageSize: refreshed.state.projectSelection?.pageSize || TAKEOVER_DISPLAY_PAGE_SIZE,
  };
  const card = buildTakeoverProjectListCard(refreshed.projects, pageOptions);
  const text = formatTakeoverProjectList(refreshed.projects, pageOptions);
  return replyCardOrText(ctx, event.messageId, card, text);
}

async function handleTakeoverProjectPage(ctx, event, action = {}) {
  const language = await languageForEvent(ctx, event);
  try {
    const paged = await setTakeoverProjectPage({
      dataDir: ctx.config.dataDir,
      page: action.page,
      pageSize: action.pageSize || TAKEOVER_DISPLAY_PAGE_SIZE,
    });
    const pageOptions = {
      language,
      page: paged.state.projectSelection?.page || 0,
      pageSize: paged.state.projectSelection?.pageSize || TAKEOVER_DISPLAY_PAGE_SIZE,
    };
    const card = buildTakeoverProjectListCard(paged.projects, pageOptions);
    const text = formatTakeoverProjectList(paged.projects, pageOptions);
    return replyCardOrText(ctx, event.messageId, card, text);
  } catch {
    return handleTakeoverProjectList(ctx, event, action);
  }
}

async function handleTakeoverProjectSelect(ctx, event, action) {
  const language = await languageForEvent(ctx, event);
  try {
    const selected = await selectTakeoverProject({
      dataDir: ctx.config.dataDir,
      selector: action.selector,
      projectIndex: action.projectIndex,
      cwd: action.cwd,
      limit: 10,
      pageSize: TAKEOVER_DISPLAY_PAGE_SIZE,
      idleDebounceMs: ctx.config.takeover?.idleDebounceMs,
      selectionTtlMs: ctx.config.takeover?.selectionTtlMs,
    });
    const pageOptions = {
      cwd: selected.project?.cwd || action.cwd || "",
      language,
      page: selected.state.selection?.page || 0,
      pageSize: selected.state.selection?.pageSize || TAKEOVER_DISPLAY_PAGE_SIZE,
    };
    const card = buildTakeoverListCard(selected.targets, pageOptions);
    const text = formatTakeoverList(selected.targets, pageOptions);
    return replyCardOrText(ctx, event.messageId, card, text);
  } catch (error) {
    return ctx.notifier.reply(event.messageId, error.message);
  }
}

async function handleTakeoverWindowList(ctx, event, action = {}) {
  const language = await languageForEvent(ctx, event);
  const scope = await takeoverListScope(ctx);
  const refreshed = await refreshTakeoverSelection({
    dataDir: ctx.config.dataDir,
    cwd: scope.cwd,
    threadId: scope.threadId,
    threadPath: scope.threadPath,
    excludeThreadId: scope.excludeThreadId,
    limit: 10,
    page: action.page || 0,
    pageSize: action.pageSize || TAKEOVER_DISPLAY_PAGE_SIZE,
    idleDebounceMs: ctx.config.takeover?.idleDebounceMs,
    selectionTtlMs: ctx.config.takeover?.selectionTtlMs,
  });
  const pageOptions = {
    cwd: scope.cwd,
    language,
    page: refreshed.state.selection?.page || 0,
    pageSize: refreshed.state.selection?.pageSize || TAKEOVER_DISPLAY_PAGE_SIZE,
  };
  const card = buildTakeoverListCard(refreshed.targets, pageOptions);
  const text = formatTakeoverList(refreshed.targets, pageOptions);
  return replyCardOrText(ctx, event.messageId, card, text);
}

async function handleTakeoverWindowPage(ctx, event, action = {}) {
  const language = await languageForEvent(ctx, event);
  try {
    const paged = await setTakeoverSelectionPage({
      dataDir: ctx.config.dataDir,
      page: action.page,
      pageSize: action.pageSize || TAKEOVER_DISPLAY_PAGE_SIZE,
    });
    const cwd = action.cwd || paged.state.scope?.cwd || paged.targets[0]?.cwd || "";
    const pageOptions = {
      cwd,
      language,
      page: paged.state.selection?.page || 0,
      pageSize: paged.state.selection?.pageSize || TAKEOVER_DISPLAY_PAGE_SIZE,
    };
    const card = buildTakeoverListCard(paged.targets, pageOptions);
    const text = formatTakeoverList(paged.targets, pageOptions);
    return replyCardOrText(ctx, event.messageId, card, text);
  } catch {
    return handleTakeoverWindowList(ctx, event, action);
  }
}

async function takeoverListScope(ctx) {
  const dataDir = ctx.config.dataDir;
  const takeover = await readTakeover({ dataDir });
  const takeoverScope = takeover?.scope || {};
  if (takeoverScope.cwd || takeoverScope.startedByThreadId) {
    return {
      cwd: takeoverScope.cwd || "",
      threadId: takeoverScope.startedByThreadId || "",
      threadPath: takeoverScope.startedByThreadPath || "",
      excludeThreadId: "",
    };
  }

  const handoff = await readHandoff({ dataDir });
  return {
    cwd: handoff?.cwd || "",
    threadId: "",
    threadPath: "",
    excludeThreadId: "",
  };
}

async function handleTakeoverSelect(ctx, event, action) {
  const language = await languageForEvent(ctx, event);
  try {
    const selected = await selectTakeoverTarget({
      dataDir: ctx.config.dataDir,
      selector: action.selector,
      optionIndex: action.optionIndex,
      threadId: action.threadId,
      messageId: event.messageId,
      chatIdHash: event.chatIdHash,
      userIdHash: event.userIdHash,
      idleDebounceMs: ctx.config.takeover?.idleDebounceMs,
    });
    return replyCardOrText(
      ctx,
      event.messageId,
      buildTakeoverSelectedCard(selected.target, { language }),
      formatTakeoverSelected(selected.target, { language }),
    );
  } catch (error) {
    return ctx.notifier.reply(event.messageId, error.message);
  }
}

async function handleTakeoverConfirm(ctx, event, action) {
  const language = await languageForEvent(ctx, event);
  try {
    const selected = await selectTakeoverTarget({
      dataDir: ctx.config.dataDir,
      selector: action.selector,
      optionIndex: action.optionIndex,
      threadId: action.threadId,
      messageId: event.messageId,
      chatIdHash: event.chatIdHash,
      userIdHash: event.userIdHash,
      idleDebounceMs: ctx.config.takeover?.idleDebounceMs,
    });
    return replyCardOrText(
      ctx,
      event.messageId,
      buildTakeoverConfirmCard(selected.target, { language }),
      language === "en"
        ? `Confirm takeover?\n\n${formatTakeoverSelected(selected.target, { language })}`
        : `确认接管？\n\n${formatTakeoverSelected(selected.target, { language })}`,
    );
  } catch (error) {
    return ctx.notifier.reply(event.messageId, error.message);
  }
}

async function handleTakeoverObserve(ctx, event, action) {
  const language = await languageForEvent(ctx, event);
  try {
    const selected = await selectTakeoverTarget({
      dataDir: ctx.config.dataDir,
      selector: action.selector,
      optionIndex: action.optionIndex,
      threadId: action.threadId,
      messageId: event.messageId,
      chatIdHash: event.chatIdHash,
      userIdHash: event.userIdHash,
      idleDebounceMs: ctx.config.takeover?.idleDebounceMs,
    });
    const observation = await activateObservation({
      dataDir: ctx.config.dataDir,
      selector: selected.target.threadId,
      cwd: selected.target.cwd,
      messageId: event.messageId,
      chatIdHash: event.chatIdHash,
      userIdHash: event.userIdHash,
      language,
      activatedBy: "lark-intent",
    });
    const delivered = await deliverObservationStatus(ctx, event, observation, { language });
    await ctx.observer?.start(delivered.observation);
    return delivered.delivery;
  } catch (error) {
    return ctx.notifier.reply(event.messageId, error.message);
  }
}

async function handleTakeoverExecute(ctx, event, action) {
  const language = await languageForEvent(ctx, event);
  try {
    const executed = await executeTakeoverForBridge(ctx, {
      selector: action.selector,
      optionIndex: action.optionIndex,
      threadId: action.threadId,
      messageId: event.messageId,
      chatIdHash: event.chatIdHash,
      userIdHash: event.userIdHash,
    });
    await setIntentSessionModeForEvent(ctx, event, "handoff", "takeover_execute");
    return ctx.notifier.reply(event.messageId, formatTakeoverExecution(executed, { language }));
  } catch (error) {
    return ctx.notifier.reply(event.messageId, error.message);
  }
}

async function handleCardAction(ctx, event) {
  const language = await languageForEvent(ctx, event);
  const action = event.value?.action || event.action || "";
  const payload = {
    optionIndex: event.value?.optionIndex,
    projectIndex: event.value?.projectIndex,
    cwd: event.value?.cwd,
    threadId: event.value?.threadId,
    page: event.value?.page,
    pageSize: event.value?.pageSize,
    messageId: event.messageId,
    chatIdHash: event.chatIdHash,
    userIdHash: event.userIdHash,
  };
  try {
    if (action === "takeover_list") return handleTakeoverProjectList(ctx, event);
    if (action === "takeover_window_list") return handleTakeoverWindowList(ctx, event);
    if (action === "takeover_project_page") return handleTakeoverProjectPage(ctx, event, payload);
    if (action === "takeover_window_page") return handleTakeoverWindowPage(ctx, event, payload);
    if (action === "takeover_project_select") return handleTakeoverProjectSelect(ctx, event, { kind: "takeover_project_select", ...payload });
    if (action === "takeover_view") return handleTakeoverSelect(ctx, event, { kind: "takeover_select", ...payload });
    if (action === "takeover_observe") {
      const selected = await selectTakeoverTarget({
        dataDir: ctx.config.dataDir,
        ...payload,
        idleDebounceMs: ctx.config.takeover?.idleDebounceMs,
      });
      const observation = await activateObservation({
        dataDir: ctx.config.dataDir,
        selector: selected.target.threadId,
        cwd: selected.target.cwd,
        messageId: event.messageId,
        chatIdHash: event.chatIdHash,
        userIdHash: event.userIdHash,
        language,
        activatedBy: "lark-card",
      });
      const delivered = await deliverObservationStatus(ctx, event, observation, { language });
      await ctx.observer?.start(delivered.observation);
      return delivered.delivery;
    }
    if (action === "takeover_confirm") {
      const selected = await selectTakeoverTarget({
        dataDir: ctx.config.dataDir,
        ...payload,
        idleDebounceMs: ctx.config.takeover?.idleDebounceMs,
      });
      return replyCardOrText(
        ctx,
        event.messageId,
        buildTakeoverConfirmCard(selected.target, { language }),
        language === "en"
          ? `Confirm takeover?\n\n${formatTakeoverSelected(selected.target, { language })}`
          : `确认接管？\n\n${formatTakeoverSelected(selected.target, { language })}`,
      );
    }
    if (action === "takeover_execute") {
      return handleTakeoverExecute(ctx, event, { kind: "takeover_execute", ...payload });
    }
    if (action === "takeover_cancel") {
      return handleTakeoverDisable(ctx, event, { language });
    }
    return replyMaybe(ctx, event.messageId, "Unknown takeover action.");
  } catch (error) {
    return replyMaybe(ctx, event.messageId, error.message);
  }
}

export async function prepareDispatchCommand(ctx, remoteCommandId) {
  const command = remoteCommandId && typeof ctx.queue.get === "function" ? await ctx.queue.get(remoteCommandId) : null;
  if (!command) {
    return { success: false, error: "Remote command not found." };
  }
  if (command.mode !== "thread_handoff") {
    return { success: false, error: "Remote command is not a control-window dispatch command.", data: { remoteCommandId: command.id } };
  }

  const handoff = await readHandoff({ dataDir: ctx.config.dataDir });
  const takeover = await readTakeover({ dataDir: ctx.config.dataDir });
  const target = normalizeDispatchTarget(command.dispatchTarget)
    || (["active", "pending"].includes(takeover?.state || "") ? normalizeDispatchTarget(takeover.target) : null);
  const data = {
    remoteCommandId: command.id,
    status: command.status,
    action: "dispatch",
    recordRequired: true,
    feishuMessage: command.normalizedTask || command.prompt || "",
    target,
    targetPrompt: buildTargetDispatchPrompt(command),
    controlWindow: {
      threadId: handoff?.threadId || "",
      threadPath: handoff?.threadPath || "",
      cwd: handoff?.cwd || "",
      name: handoff?.name || "",
      lockedAt: handoff?.controlWindow?.lockedAt || handoff?.activatedAt || "",
    },
  };

  if (!handoff?.active) {
    return {
      success: true,
      data: { ...data, action: "blocked", targetPrompt: "", reason: "No active Lark Remote control window is locked." },
      text: "No active Lark Remote control window is locked.",
    };
  }
  if (!target?.threadId) {
    return {
      success: true,
      data: {
        ...data,
        action: "clarify",
        targetPrompt: "",
        reason: "No selected target session is available for this work request.",
      },
      text: "No selected target session is available for this work request.",
    };
  }
  return {
    success: true,
    data,
    text: `Dispatch prepared for ${target.name || target.threadId}.`,
  };
}

export async function routeRemoteCommand(ctx, remoteCommandId) {
  const command = remoteCommandId && typeof ctx.queue.get === "function" ? await ctx.queue.get(remoteCommandId) : null;
  if (!command) {
    return { success: false, error: "Remote command not found." };
  }
  if (command.mode !== "thread_handoff") {
    return { success: false, error: "Remote command is not a control-window command.", data: { remoteCommandId: command.id } };
  }

  const [handoff, takeover] = await Promise.all([
    readHandoff({ dataDir: ctx.config.dataDir }),
    readTakeover({ dataDir: ctx.config.dataDir }),
  ]);
  const text = String(command.normalizedTask || command.prompt || "").trim();
  const target = normalizeDispatchTarget(command.dispatchTarget)
    || (["active", "pending"].includes(takeover?.state || "") ? normalizeDispatchTarget(takeover.target) : null);
  const classifiedAction = classifyChatText(text, ctx.config);
  if (isRoutableControlAction(classifiedAction)) {
    const routed = routeControlAction(classifiedAction, { command, target });
    return {
      success: true,
      data: {
        remoteCommandId: command.id,
        feishuMessage: text,
        activeTarget: target,
        controlWindowContract: controlWindowRouteContract(routed),
        ...routed,
      },
      text: routed.summary,
    };
  }
  if (classifiedAction?.kind === "rejected") {
    const routed = controlReplyRoute(classifiedAction.reason || "这条消息不能作为 Lark Remote 指令处理。", command.id);
    return {
      success: true,
      data: {
        remoteCommandId: command.id,
        feishuMessage: text,
        activeTarget: target,
        controlWindowContract: controlWindowRouteContract(routed),
        ...routed,
      },
      text: routed.summary,
    };
  }

  const controlAction = parseControlSemanticAction(text, {
    mode: "console",
    state: { handoff, takeover },
  });
  if (controlAction) {
    const routed = routeControlAction(controlAction, { command, target });
    return {
      success: true,
      data: {
        remoteCommandId: command.id,
        feishuMessage: text,
        activeTarget: target,
        controlWindowContract: controlWindowRouteContract(routed),
        ...routed,
      },
      text: routed.summary,
    };
  }

  const prepared = await prepareDispatchCommand(ctx, command.id);
  if (!prepared.success) return prepared;
  if (prepared.data.action === "dispatch") {
    return {
      success: true,
      data: {
        ...prepared.data,
        action: "dispatch",
        nextTool: "lark_dispatch_remote_command",
        completionTool: "lark_dispatch_remote_command",
        toolInput: {
          remoteCommandId: command.id,
        },
        completionToolInput: {
          remoteCommandId: command.id,
        },
        controlWindowContract: controlWindowRouteContract({ action: "dispatch", completionTool: "lark_dispatch_remote_command" }),
        summary: "Dispatch this work request to the selected target session.",
      },
      text: "Dispatch this work request to the selected target session.",
    };
  }
  if (prepared.data.action === "clarify") {
    return {
      success: true,
      data: {
        ...prepared.data,
        action: "clarify",
        nextTool: "lark_request_clarification",
        question: "这条消息要投递到哪个 Codex 会话？",
        toolInput: {
          remoteCommandId: command.id,
          question: "这条消息要投递到哪个 Codex 会话？",
        },
        completionTool: "lark_request_clarification",
        completionToolInput: {
          remoteCommandId: command.id,
          question: "这条消息要投递到哪个 Codex 会话？",
        },
        controlWindowContract: controlWindowRouteContract({ action: "clarify", completionTool: "lark_request_clarification" }),
        summary: "Ask the Feishu/Lark user to select a target session.",
      },
      text: "Ask the Feishu/Lark user to select a target session.",
    };
  }
  return {
    success: true,
    data: {
      ...prepared.data,
      action: "blocked",
      nextTool: "lark_record_dispatch",
      completionTool: "lark_record_dispatch",
      toolInput: {
        remoteCommandId: command.id,
        status: "blocked_retryable",
        error: prepared.data.reason || "Dispatch is blocked.",
      },
      completionToolInput: {
        remoteCommandId: command.id,
        status: "blocked_retryable",
        error: prepared.data.reason || "Dispatch is blocked.",
      },
      controlWindowContract: controlWindowRouteContract({ action: "blocked", completionTool: "lark_record_dispatch" }),
      summary: prepared.data.reason || "Dispatch is blocked.",
    },
    text: prepared.data.reason || "Dispatch is blocked.",
  };
}

export async function dispatchRemoteCommand(ctx, input = {}) {
  const remoteCommandId = input.remoteCommandId || input.commandId || input.id || "";
  const command = remoteCommandId && typeof ctx.queue.get === "function" ? await ctx.queue.get(remoteCommandId) : null;
  if (!command) return { success: false, error: "Remote command not found." };
  if (command.mode !== "thread_handoff") {
    return { success: false, error: "Remote command is not a control-window dispatch command.", data: { remoteCommandId: command.id } };
  }
  if (command.dispatchTargetCommandId) {
    const existing = typeof ctx.queue.get === "function" ? await ctx.queue.get(command.dispatchTargetCommandId).catch(() => null) : null;
    if (existing && !["failed", "cancelled"].includes(existing.status)) {
      const recorded = await recordDispatchCommand(ctx, {
        remoteCommandId: command.id,
        status: "sent",
        targetThreadId: command.dispatchTargetThreadId || existing.codexSessionId,
        targetTitle: command.dispatchTarget?.name || "",
        hostTool: "lark_dispatch_remote_command",
        evidence: `target command already queued: ${existing.id}`,
      });
      return {
        success: true,
        data: { remoteCommandId: command.id, targetCommand: existing, recorded: recorded.data },
        text: recorded.text,
      };
    }
  }

  const prepared = await prepareDispatchCommand(ctx, command.id);
  if (!prepared.success) return prepared;
  if (prepared.data.action === "clarify") {
    const clarified = await requestDispatchClarification(ctx, {
      remoteCommandId: command.id,
      question: "这条消息要投递到哪个 Codex 会话？",
    });
    return { ...clarified, data: { ...(clarified.data || {}), action: "clarify" } };
  }
  if (prepared.data.action !== "dispatch") {
    const recorded = await recordDispatchCommand(ctx, {
      remoteCommandId: command.id,
      status: "blocked_retryable",
      error: prepared.data.reason || "Dispatch is blocked.",
    });
    return { ...recorded, data: { ...(recorded.data || {}), action: "blocked" } };
  }

  const target = prepared.data.target || {};
  const targetCommand = await ctx.queue.enqueue({
    source: "lark",
    mode: "thread_handoff",
    presentation: "chat",
    notifyQueued: false,
    notifyStarted: false,
    controlWindowCommand: false,
    targetWindowDispatch: true,
    handoffDispatch: true,
    parentRemoteCommandId: command.id,
    dispatchTarget: target,
    takeoverState: command.takeoverState || "",
    repoKey: "current",
    projectRoot: target.cwd || command.projectRoot || "",
    prompt: prepared.data.targetPrompt,
    normalizedTask: command.normalizedTask || command.prompt || "",
    messageId: command.messageId,
    chatIdHash: command.chatIdHash,
    userIdHash: command.userIdHash,
    userName: command.userName,
    codexSessionId: target.threadId,
    codexSessionPath: target.threadPath || "",
  });
  await ctx.queue.update(
    command.id,
    {
      dispatchTargetCommandId: targetCommand.id,
      dispatchTargetThreadId: target.threadId || "",
      dispatchTargetTitle: target.name || "",
    },
    "dispatch_target_queued",
  );
  const recorded = await recordDispatchCommand(ctx, {
    remoteCommandId: command.id,
    status: "sent",
    targetThreadId: target.threadId || "",
    targetTitle: target.name || "",
    hostTool: "lark_dispatch_remote_command",
    readbackOk: true,
    evidence: `target command queued: ${targetCommand.id}`,
  });
  Promise.resolve(ctx.runner?.processAll?.()).catch(() => {});
  return {
    success: true,
    data: {
      remoteCommandId: command.id,
      action: "dispatch",
      targetCommand,
      recorded: recorded.data,
    },
    text: recorded.text,
  };
}

export async function recordDispatchCommand(ctx, input = {}) {
  const remoteCommandId = input.remoteCommandId || input.commandId || input.id || "";
  const command = remoteCommandId && typeof ctx.queue.get === "function" ? await ctx.queue.get(remoteCommandId) : null;
  if (!command) return { success: false, error: "Remote command not found." };
  const status = normalizeDispatchRecordStatus(input.status);
  if (!status) return { success: false, error: "Invalid dispatch status.", data: { remoteCommandId: command.id } };

  const language = await languageForEvent(ctx, { chatIdHash: command.chatIdHash, text: command.prompt });
  const text = formatDispatchRecordText(command, {
    status,
    language,
    targetTitle: input.targetTitle || input.target?.name || command.dispatchTarget?.name || "",
    error: input.error || input.reason || "",
  });
  const now = nowIso();
  const updated = await ctx.queue.update(
    command.id,
    {
      status,
      dispatchStatus: status,
      dispatchRecordedAt: now,
      dispatchTargetThreadId: input.targetThreadId || input.target?.threadId || command.dispatchTarget?.threadId || "",
      dispatchHostTool: input.hostTool || input.tool || "",
      dispatchReadbackOk: input.readbackOk === true,
      dispatchEvidence: input.evidence || input.readback || "",
      result: status === "dispatch_sent" ? text : "",
      error: status === "dispatch_sent" ? "" : text,
      completedAt: ["dispatch_sent", "blocked_retryable", "failed"].includes(status) ? now : command.completedAt || "",
    },
    "dispatch_recorded",
  );
  if (updated?.messageId) await replyMaybe(ctx, updated.messageId, text);
  return { success: true, data: updated, text };
}

export async function requestDispatchClarification(ctx, input = {}) {
  const remoteCommandId = input.remoteCommandId || input.commandId || input.id || "";
  const command = remoteCommandId && typeof ctx.queue.get === "function" ? await ctx.queue.get(remoteCommandId) : null;
  if (!command) return { success: false, error: "Remote command not found." };
  const language = await languageForEvent(ctx, { chatIdHash: command.chatIdHash, text: command.prompt });
  const question = String(input.question || "").trim()
    || (language === "en" ? "Which Codex session should receive this message?" : "这条消息要投递到哪个 Codex 会话？");
  const now = nowIso();
  const updated = await ctx.queue.update(
    command.id,
    {
      status: "waiting_clarification",
      dispatchStatus: "waiting_clarification",
      clarificationQuestion: question,
      dispatchRecordedAt: now,
      error: question,
    },
    "dispatch_clarification_requested",
  );
  if (updated?.messageId) await replyMaybe(ctx, updated.messageId, question);
  return { success: true, data: updated, text: question };
}

export async function replyRemoteCommand(ctx, input = {}) {
  const remoteCommandId = input.remoteCommandId || input.commandId || input.id || "";
  const command = remoteCommandId && typeof ctx.queue.get === "function" ? await ctx.queue.get(remoteCommandId) : null;
  if (!command) return { success: false, error: "Remote command not found." };
  if (command.mode !== "thread_handoff") {
    return { success: false, error: "Remote command is not a control-window command.", data: { remoteCommandId: command.id } };
  }
  const text = String(input.text || input.message || "").trim();
  if (!text) return { success: false, error: "Reply text is required.", data: { remoteCommandId: command.id } };
  const status = normalizeRemoteReplyStatus(input.status);
  const now = nowIso();
  const updated = await ctx.queue.update(
    command.id,
    {
      status,
      controlStatus: status,
      controlRecordedAt: now,
      result: status === "control_completed" ? text : "",
      error: status === "control_completed" ? "" : text,
      completedAt: ["control_completed", "blocked_retryable", "failed"].includes(status) ? now : command.completedAt || "",
    },
    "control_reply_recorded",
  );
  if (updated?.messageId) await replyMaybe(ctx, updated.messageId, text);
  return { success: true, data: updated, text };
}

function buildTargetDispatchPrompt(command = {}) {
  const prompt = String(command.normalizedTask || command.prompt || "").trim();
  return ["[Lark Remote dispatch]", prompt].filter(Boolean).join("\n");
}

function routeControlAction(action = {}, { command = {} } = {}) {
  const remoteCommandId = command.id || "";
  const selector = action.selector || action.optionIndex || action.threadId || "";
  const control = (nextTool, toolInput, summary) =>
    controlRoute("control", nextTool, toolInput, summary, remoteCommandId);
  switch (action.kind) {
    case "setup_verify":
      return control("lark_verify_setup", {}, "Verify Lark Remote setup, then reply with lark_reply_remote_command.");
    case "status":
    case "handoff_status":
    case "takeover_status":
      return control("lark_get_bridge_status", {}, "Read Lark Remote status, then reply with lark_reply_remote_command.");
    case "help":
      return controlReplyRoute("可用操作：项目列表、进入项目 1、会话列表、接管 1、观察会话 2、退出接管、status。", remoteCommandId);
    case "whoami":
      return controlReplyRoute("请在飞书里发送 whoami 获取当前用户身份。", remoteCommandId);
    case "takeover_list":
      return control("lark_list_projects", {}, "List projects, then reply with lark_reply_remote_command.");
    case "takeover_project_select":
      return control("lark_select_project", { selector }, "Select the project, then reply with lark_reply_remote_command.");
    case "takeover_window_list":
      return control("lark_list_project_sessions", {}, "List sessions, then reply with lark_reply_remote_command.");
    case "takeover_select":
      return control("lark_select_target", { selector }, "Select the target session, then reply with lark_reply_remote_command.");
    case "takeover_confirm":
    case "takeover_execute":
      return control("lark_confirm_takeover", { selector }, "Confirm takeover, then reply with lark_reply_remote_command.");
    case "takeover_observe":
    case "observe_enable":
      return control("lark_start_observation", { selector, remoteCommandId }, "Start observation, then reply with lark_reply_remote_command.");
    case "observe_list":
      return control("lark_list_observation_targets", {}, "List observation targets, then reply with lark_reply_remote_command.");
    case "observe_disable":
      return control("lark_stop_observation", {}, "Stop observation, then reply with lark_reply_remote_command.");
    case "handoff_disable":
      return control("lark_exit_takeover", { remoteCommandId }, "End active takeover, then reply with lark_reply_remote_command.");
    case "takeover_disable":
      return control("lark_cancel_takeover", { remoteCommandId }, "Cancel takeover selection or waiting takeover, then reply with lark_reply_remote_command.");
    case "bridge_stop_confirm":
      return controlReplyRoute("关闭飞书连接会断开后续回复。请发送“确认关闭飞书连接”继续。", remoteCommandId);
    case "bridge_stop_cancel":
      return controlReplyRoute("已取消关闭飞书连接。", remoteCommandId);
    case "bridge_stop_execute":
      return control("lark_stop", { remoteCommandId }, "正在关闭飞书连接。");
    case "command_visibility":
      return control(
        "lark_set_command_visibility",
        { enabled: action.enabled },
        "Update command visibility, then reply with lark_reply_remote_command.",
      );
    case "task_status":
    case "task_diff":
      return control("lark_get_remote_command", { id: action.id || action.remoteCommandId || remoteCommandId }, "Read the remote command, then reply with lark_reply_remote_command.");
    case "cancel":
      return control("lark_cancel_remote_command", { id: action.id || action.remoteCommandId || remoteCommandId }, "Cancel the remote command, then reply with lark_reply_remote_command.");
    case "approve":
      return control(
        "lark_approve_remote_command",
        { id: action.id || action.remoteCommandId || remoteCommandId, action: action.action || "review" },
        "Approve the remote command action, then reply with lark_reply_remote_command.",
      );
    default:
      return {
        action: "clarify",
        nextTool: "lark_request_clarification",
        question: "我还没识别出这条控制指令，要查看项目列表还是投递到当前会话？",
        toolInput: {
          remoteCommandId,
          question: "我还没识别出这条控制指令，要查看项目列表还是投递到当前会话？",
        },
        completionTool: "lark_request_clarification",
        completionToolInput: {
          remoteCommandId,
          question: "我还没识别出这条控制指令，要查看项目列表还是投递到当前会话？",
        },
        controlWindowContract: controlWindowRouteContract({ action: "clarify", completionTool: "lark_request_clarification" }),
        summary: "Ask for clarification.",
      };
  }
}

function isRoutableControlAction(action = {}) {
  return Boolean(action && !["task", "empty", "rejected"].includes(action.kind));
}

function controlRoute(action, nextTool, toolInput, summary, remoteCommandId = "") {
  return {
    action,
    nextTool,
    toolInput,
    completionTool: "lark_reply_remote_command",
    completionToolInput: { remoteCommandId },
    controlWindowContract: controlWindowRouteContract({ action, completionTool: "lark_reply_remote_command" }),
    summary,
  };
}

function controlReplyRoute(text, remoteCommandId = "") {
  return {
    action: "control_reply",
    nextTool: "lark_reply_remote_command",
    toolInput: { remoteCommandId, text },
    completionTool: "lark_reply_remote_command",
    completionToolInput: { remoteCommandId, text },
    controlWindowContract: controlWindowRouteContract({ action: "control_reply", completionTool: "lark_reply_remote_command" }),
    summary: "Reply directly and mark the command handled.",
  };
}

function controlWindowRouteContract(route = {}) {
  return {
    role: "control_window",
    firstToolAlreadyCalled: "lark_route_remote_command",
    nextToolIsAuthoritative: true,
    localRepositoryWorkAllowed: false,
    completionRequired: route.completionTool || "",
    finishAfterCompletionTool: true,
  };
}

function normalizeDispatchRecordStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (["sent", "dispatch_sent", "delivered"].includes(value)) return "dispatch_sent";
  if (["blocked", "blocked_retryable", "retryable"].includes(value)) return "blocked_retryable";
  if (["clarify", "waiting_clarification"].includes(value)) return "waiting_clarification";
  if (["failed", "failure", "error"].includes(value)) return "failed";
  return "";
}

function normalizeRemoteReplyStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value || ["done", "completed", "complete", "control_completed"].includes(value)) return "control_completed";
  if (["blocked", "blocked_retryable", "retryable"].includes(value)) return "blocked_retryable";
  if (["failed", "failure", "error"].includes(value)) return "failed";
  return "control_completed";
}

function formatDispatchRecordText(command = {}, options = {}) {
  const language = options.language === "en" ? "en" : "zh";
  const title = options.targetTitle || command.dispatchTarget?.name || command.dispatchTarget?.threadId || "";
  if (options.status === "dispatch_sent") {
    return language === "en"
      ? `Dispatched to: ${title || "selected Codex session"}`
      : `已派发到：${title || "已选 Codex 会话"}`;
  }
  if (options.status === "waiting_clarification") {
    return options.error || (language === "en" ? "Waiting for clarification." : "等待确认。");
  }
  if (options.status === "blocked_retryable") {
    const reason = options.error || (language === "en" ? "Host thread dispatch is temporarily unavailable." : "宿主线程派发暂时不可用。");
    return language === "en"
      ? `Dispatch is blocked but retained.\nReason: ${reason}`
      : `暂时无法派发，消息已保留。\n原因：${reason}`;
  }
  const reason = options.error || (language === "en" ? "Unknown dispatch failure." : "未知派发失败。");
  return language === "en" ? `Dispatch failed.\nReason: ${reason}` : `派发失败。\n原因：${reason}`;
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

async function enqueueHandoffTask(ctx, input) {
  const guidance = Boolean(input.runningCommand);
  const text = guidance ? buildHandoffGuidancePrompt(input.text, input.runningCommand) : input.text;
  const dispatchTarget = normalizeDispatchTarget(input.dispatchTarget);
  return ctx.queue.enqueue({
    source: "lark",
    mode: "thread_handoff",
    presentation: "chat",
    notifyQueued: guidance || ctx.config.handoff?.notifyQueued === true,
    notifyStarted: ctx.config.handoff?.notifyStarted !== false,
    controlWindowCommand: true,
    handoffGuidance: guidance,
    handoffDispatch: Boolean(dispatchTarget),
    dispatchTarget,
    takeoverState: input.takeover?.state || "",
    guidanceForCommandId: input.runningCommand?.id || "",
    repoKey: "current",
    projectRoot: input.handoff.cwd || "",
    prompt: text,
    normalizedTask: input.text,
    messageId: input.messageId,
    chatIdHash: input.chatIdHash,
    userIdHash: input.userIdHash,
    userName: input.userName,
    codexSessionId: input.handoff.threadId,
    codexSessionPath: input.handoff.threadPath || "",
  });
}

function normalizeDispatchTarget(target = {}) {
  if (!target?.threadId) return null;
  return {
    threadId: target.threadId || "",
    threadPath: target.threadPath || "",
    cwd: target.cwd || "",
    name: target.name || "",
    status: target.status || "",
    statusReason: target.statusReason || "",
    lastEventAtMs: target.lastEventAtMs || target.updatedAtMs || 0,
  };
}

async function findRunningHandoffTask(ctx, handoff) {
  if (!ctx.runner?.busy || !handoff?.threadId || typeof ctx.queue.list !== "function") return null;
  const commands = await ctx.queue.list({ limit: 50 });
  return commands.find((command) =>
    command.mode === "thread_handoff"
    && command.status === "running"
    && command.codexSessionId === handoff.threadId
  ) || null;
}

async function cancelHandoffTasks(ctx, threadId) {
  if (!threadId || typeof ctx.queue.list !== "function" || typeof ctx.queue.cancel !== "function") return [];
  const commands = await ctx.queue.list({ limit: 200 });
  const activeStatuses = new Set(["pending", "running"]);
  const matches = commands.filter((command) =>
    command.mode === "thread_handoff"
    && command.codexSessionId === threadId
    && activeStatuses.has(command.status)
  );
  const cancelled = [];
  for (const command of matches) {
    const result = await ctx.queue.cancel(command.id, "handoff disabled by user");
    if (result) cancelled.push(result);
  }
  return cancelled;
}

async function cancelInactiveHandoffTasks(ctx) {
  const handoff = await readHandoff({ dataDir: ctx.config.dataDir });
  const activeThreadId = handoff?.threadId || "";
  if (typeof ctx.queue.list !== "function" || typeof ctx.queue.cancel !== "function") return [];
  const commands = await ctx.queue.list({ limit: 200 });
  const activeStatuses = new Set(["pending", "running"]);
  const matches = commands.filter((command) =>
    command.mode === "thread_handoff"
    && activeStatuses.has(command.status)
    && (!activeThreadId || command.codexSessionId !== activeThreadId)
  );
  const cancelled = [];
  for (const command of matches) {
    const result = await ctx.queue.cancel(command.id, "handoff inactive");
    if (result) cancelled.push(result);
  }
  return cancelled;
}

async function handleHandoffDisable(ctx, event, { handoff, language } = {}) {
  const cleared = await clearTakeover({ dataDir: ctx.config.dataDir });
  await stopPendingTakeoverObservation(ctx, cleared?.previous);
  await setIntentSessionModeForEvent(ctx, event, "console", "handoff_disabled");
  ctx.keepAwake?.stop();
  return replyCardOrText(ctx, event.messageId, buildHandoffDisabledCard({ language }), formatHandoffDisabled({ language }));
}

async function handleTakeoverDisable(ctx, event, { handoff, language } = {}) {
  const takeover = await readTakeover({ dataDir: ctx.config.dataDir });
  if (takeover?.state === "active") {
    return handleHandoffDisable(ctx, event, { handoff, language });
  }
  if (!["selecting_project", "selecting", "selected", "pending"].includes(takeover?.state || "")) {
    return ctx.notifier.reply(event.messageId, formatTakeoverPreparationNotActive({ handoff }, { language }));
  }
  const cleared = await clearTakeover({ dataDir: ctx.config.dataDir });
  await stopPendingTakeoverObservation(ctx, cleared?.previous);
  await setIntentSessionModeForEvent(ctx, event, handoff?.active ? "handoff" : "console", "takeover_cancelled");
  return ctx.notifier.reply(
    event.messageId,
    formatTakeoverPreparationCancelled({ takeover: cleared?.previous || takeover, handoff }, { language }),
  );
}

async function withTakeoverSelectionContext(ctx, event, action) {
  const text = String(event.text || "").trim();
  const takeover = await readTakeover({ dataDir: ctx.config.dataDir });
  if (!takeover || !["selecting_project", "selecting", "selected"].includes(takeover.state)) return action;
  if (/^(next|more|下一组|下一个|更多)$/i.test(text)) {
    if (takeover.state === "selecting_project") {
      return {
        kind: "takeover_list",
        page: Number(takeover.projectSelection?.page || 0) + 1,
        pageSize: takeover.projectSelection?.pageSize || TAKEOVER_DISPLAY_PAGE_SIZE,
      };
    }
    return {
      kind: "takeover_window_list",
      page: Number(takeover.selection?.page || 0) + 1,
      pageSize: takeover.selection?.pageSize || TAKEOVER_DISPLAY_PAGE_SIZE,
    };
  }
  if (/^(prev|previous|back|上一组|上一个)$/i.test(text)) {
    if (takeover.state === "selecting_project") {
      return {
        kind: "takeover_list",
        page: Number(takeover.projectSelection?.page || 0) - 1,
        pageSize: takeover.projectSelection?.pageSize || TAKEOVER_DISPLAY_PAGE_SIZE,
      };
    }
    return {
      kind: "takeover_window_list",
      page: Number(takeover.selection?.page || 0) - 1,
      pageSize: takeover.selection?.pageSize || TAKEOVER_DISPLAY_PAGE_SIZE,
    };
  }
  if (takeover.state === "selecting_project" && action.kind === "takeover_select" && action.selector) {
    return { kind: "takeover_project_select", selector: action.selector };
  }
  if (/^\d+$/.test(text) && ["task", "takeover_select"].includes(action.kind)) {
    return takeover.state === "selecting_project"
      ? { kind: "takeover_project_select", selector: text }
      : { kind: "takeover_select", selector: text };
  }
  if (action.kind !== "task") return action;
  if (/^(projects|project|项目|项目列表)$/i.test(text)) return { kind: "takeover_list" };
  if (/^(list|列表|窗口|windows)$/i.test(text)) {
    return takeover.state === "selecting_project" ? { kind: "takeover_list" } : { kind: "takeover_window_list" };
  }
  if (/^(cancel|取消)$/i.test(text)) return { kind: "takeover_disable" };
  if (/^(observe|观察)$/i.test(text) && takeover.target?.threadId) {
    return { kind: "observe_enable", selector: takeover.target.threadId };
  }
  return action;
}

async function executeTakeoverForBridge(ctx, input = {}) {
  const controller = await readHandoff({ dataDir: ctx.config.dataDir });
  if (!controller?.active) {
    throw new Error("线程派发需要先通过专用 Codex 控制窗口开启 Lark Remote 连接。");
  }
  const executed = await executeTakeoverTarget({
    dataDir: ctx.config.dataDir,
    selector: input.selector,
    optionIndex: input.optionIndex,
    threadId: input.threadId,
    messageId: input.messageId,
    chatIdHash: input.chatIdHash,
    userIdHash: input.userIdHash,
    idleDebounceMs: ctx.config.takeover?.idleDebounceMs,
    activatedBy: input.activatedBy || "lark",
    dispatchMode: "controller",
    controllerThreadId: controller?.threadId || "",
    controllerThreadPath: controller?.threadPath || "",
    controllerCwd: controller?.cwd || "",
    controllerName: controller?.name || "",
  });
  if (!executed.pending) {
    ctx.keepAwake?.start();
    await startTakeoverTargetObservation(ctx, executed, { mode: "takeover_active_observe" });
    executed.recap = await readTakeoverActivationRecap(ctx, executed);
    await discardPendingTakeoverInputs(ctx, executed);
  } else {
    await startTakeoverTargetObservation(ctx, executed, { mode: "takeover_pending_observe" });
  }
  return executed;
}

async function processPendingTakeover(ctx) {
  if (ctx.takeoverBusy) return;
  ctx.takeoverBusy = true;
  try {
    const result = await activatePendingTakeoverIfIdle({
      dataDir: ctx.config.dataDir,
      idleDebounceMs: ctx.config.takeover?.idleDebounceMs,
      pendingTimeoutMs: ctx.config.takeover?.pendingTimeoutMs,
    });
    if (result?.timedOut) {
      await stopPendingTakeoverObservation(ctx, result.state);
      const messageId = result.state?.lark?.messageId || result.state?.pendingInputs?.at?.(-1)?.messageId || "";
      const handoff = await readHandoff({ dataDir: ctx.config.dataDir });
      const event = { chatIdHash: result.state?.lark?.chatIdHash || "" };
      const language = await languageForEvent(ctx, event);
      await setIntentSessionModeForEvent(ctx, event, handoff?.active ? "handoff" : "console", "takeover_timeout");
      await replyMaybe(ctx, messageId, formatTakeoverTimedOut({ takeover: result.state, handoff }, { language }));
      return;
    }
    if (!result?.activated || result.pending) return;
    ctx.keepAwake?.start();
    await startTakeoverTargetObservation(ctx, result, { mode: "takeover_active_observe" });
    const recap = await readTakeoverActivationRecap(ctx, result);
    await discardPendingTakeoverInputs(ctx, result);
    const messageId = result.state?.lark?.messageId || result.state?.pendingInputs?.at?.(-1)?.messageId || "";
    const language = await languageForEvent(ctx, { chatIdHash: result.state?.lark?.chatIdHash || "" });
    await replyMaybe(
      ctx,
      messageId,
      formatTakeoverActive(result.target, { language, recap }),
    );
    Promise.resolve(ctx.runner?.processAll?.()).catch(() => {});
  } finally {
    ctx.takeoverBusy = false;
  }
}

async function startTakeoverTargetObservation(ctx, result, options = {}) {
  const state = result?.state || {};
  const target = result?.target || state.target || {};
  if (!ctx.observer?.startTemporary || !["pending", "active"].includes(state.state || "") || !target.threadPath) return;
  await ctx.observer.startTemporary({
    active: true,
    mode: options.mode || (state.state === "active" ? "takeover_active_observe" : "takeover_pending_observe"),
    threadId: target.threadId || "",
    threadPath: target.threadPath || "",
    cwd: target.cwd || "",
    name: target.name || "",
    messageId: state.lark?.messageId || "",
    chatIdHash: state.lark?.chatIdHash || "",
    userIdHash: state.lark?.userIdHash || "",
    activatedAt: state.activatedAt || state.pendingAt || nowIso(),
    activatedBy: state.state === "active" ? "takeover-active" : "takeover-pending",
  });
}

async function stopPendingTakeoverObservation(ctx, state = {}) {
  if (!ctx.observer?.stopTemporary) return;
  await ctx.observer.stopTemporary({ threadId: state?.target?.threadId || state?.previousThreadId || "" });
}

async function discardPendingTakeoverInputs(ctx, result) {
  const inputs = result.state?.pendingInputs || [];
  if (!inputs.length) return null;
  return clearPendingTakeoverInputs({ dataDir: ctx.config.dataDir });
}

function formatTakeoverExecution(executed, options = {}) {
  if (executed?.pending) return formatTakeoverPending(executed.target, options);
  return formatTakeoverActive(executed?.target, { ...options, recap: executed?.recap });
}

async function readTakeoverActivationRecap(ctx, result) {
  const sessionPath = result?.target?.threadPath || result?.handoff?.threadPath || "";
  if (!sessionPath) return null;
  return readSessionLastTurnSummary(sessionPath, {
    showCommands: ctx.config.handoff?.showCommands === true,
  });
}

async function detectBusyHandoffSession(ctx, handoff) {
  if (!handoff?.threadPath) return null;
  const status = await detectSessionStatus(handoff.threadPath, {
    idleDebounceMs: ctx.config.handoff?.idleDebounceMs ?? ctx.config.takeover?.idleDebounceMs,
  });
  return status.status === "running" ? status : null;
}

async function buildSetupVerificationFromBridge(ctx) {
  let auth = null;
  if (typeof ctx.notifier?.checkAuth === "function") {
    try {
      auth = await ctx.notifier.checkAuth();
    } catch (error) {
      auth = { ok: false, hasCredentials: true, message: error.message };
    }
  }
  return buildLarkSetupVerificationReport({
    config: ctx.config,
    auth,
    status: {
      running: true,
      state: { url: publicUrl(ctx.config) },
      data: {
        larkWs: ctx.larkWs?.status?.() || null,
      },
    },
  });
}

async function replyCardOrText(ctx, messageId, card, text) {
  if (ctx.notifier?.replyCard) {
    const delivered = await ctx.notifier.replyCard(messageId, card);
    if (delivered?.ok) return delivered;
  }
  return replyMaybe(ctx, messageId, text);
}

async function deliverObservationStatus(ctx, event, observation, options = {}) {
  const text = formatObservationStatus(observation, options);
  const delivery = await sendSessionAnchoredText(ctx, event, text);
  const messageId = deliveredMessageId(delivery);
  if (!messageId) return { delivery, observation };
  const updated = await updateObservationMessageId({
    dataDir: ctx.config.dataDir,
    threadId: observation.threadId,
    messageId,
  });
  return { delivery, observation: updated || { ...observation, messageId } };
}

async function sendSessionAnchoredText(ctx, event, text) {
  if (event.chatId && ctx.notifier?.send) {
    const delivered = await ctx.notifier.send(event.chatId, text, { receiveIdType: "chat_id" });
    if (delivered?.ok) return delivered;
  }
  return replyMaybe(ctx, event.messageId, text);
}

function deliveredMessageId(delivery) {
  return delivery?.messageId || delivery?.messageIds?.find(Boolean) || "";
}

async function replyMaybe(ctx, messageId, text) {
  if (!messageId || !ctx.notifier?.reply) return null;
  return ctx.notifier.reply(messageId, text);
}

async function maybeSendStartupIntro(ctx, options = {}) {
  const result = await sendStartupIntroIfNeeded(ctx, options);
  if (result?.error) {
    ctx.logger?.warn?.(`[codex-lark-remote] startup intro not sent: ${result.error}`);
  }
  return result;
}

async function refreshBridgeConfig(ctx) {
  if (!ctx.config?.dataDir) return ctx.config;
  try {
    const targetPath = ctx.config.configPath || configFilePath(ctx.config.dataDir);
    await fs.access(targetPath);
    ctx.config = await loadConfig({
      dataDir: ctx.config.dataDir,
      configPath: ctx.config.configPath,
    });
  } catch (error) {
    if (error.code === "ENOENT") return ctx.config;
    ctx.logger?.warn?.(`[codex-lark-remote] config reload failed: ${error.message}`);
  }
  return ctx.config;
}

async function setIntentSessionModeForEvent(ctx, event, mode, reason) {
  if (!ctx.config?.dataDir || !event?.chatIdHash) return null;
  return setIntentSessionMode({
    dataDir: ctx.config.dataDir,
    event,
    mode,
    reason,
    language: await languageForEvent(ctx, event),
  });
}

async function rememberEventLanguage(ctx, event) {
  if (!ctx.config?.dataDir || !event?.chatIdHash) return "";
  const language = detectIntentLanguage(event.text);
  if (!language) return "";
  await setIntentSessionLanguage({
    dataDir: ctx.config.dataDir,
    event,
    language,
    reason: "lark_input",
  });
  return language;
}

async function languageForEvent(ctx, event) {
  if (!ctx.config?.dataDir || !event?.chatIdHash) {
    return detectIntentLanguage(event?.text) || (ctx.config?.intent?.language === "en" ? "en" : "zh");
  }
  return resolveIntentSessionLanguage({
    dataDir: ctx.config.dataDir,
    event,
    config: ctx.config,
    text: event?.text || "",
  });
}

async function readCommandForBridgeInput(ctx, input = {}) {
  const remoteCommandId = input.remoteCommandId || input.commandId || input.id || "";
  if (!remoteCommandId || typeof ctx.queue?.get !== "function") return null;
  return ctx.queue.get(remoteCommandId).catch(() => null);
}

function eventFromRemoteCommand(command = {}) {
  return {
    messageId: command?.messageId || "",
    chatIdHash: command?.chatIdHash || "",
    userIdHash: command?.userIdHash || "",
    senderName: command?.userName || "",
    text: command?.normalizedTask || command?.prompt || "",
  };
}

async function languageForBridgeInput(ctx, input = {}, command = null) {
  const explicit = String(input.language || "").trim();
  if (explicit === "en" || explicit === "zh") return explicit;
  return languageForEvent(ctx, eventFromRemoteCommand(command || {}));
}

function buildHandoffGuidancePrompt(text, runningCommand) {
  return [
    "[Supplemental guidance received while the previous Feishu/Lark turn was still running]",
    "Treat this as additional guidance for the same Codex conversation. Apply it after reconciling any work already completed by the previous turn. Do not restart from scratch unless the user asks.",
    runningCommand?.id ? `Previous running task: ${runningCommand.id}` : "",
    "",
    "User guidance:",
    text,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatHandoffStatus(handoff) {
  if (!handoff?.active) {
    return [
      "当前没有接管中的 Codex 会话。",
      "飞书连接仍然保持；可以发送“控制台”“项目列表”或“会话列表”。",
    ].join("\n");
  }
  return [
    "当前正在接管 Codex 会话。",
    `模式: ${handoff.mode || "resume"}`,
    `线程: ${handoff.threadId}`,
    handoff.name ? `名称: ${handoff.name}` : "",
    handoff.cwd ? `目录: ${handoff.cwd}` : "",
    "发送普通飞书消息会继续这个 Codex 会话。",
    "发送“控制台”可临时回到外层自然语言控制台；发送“退出接管”会结束当前接管但保留飞书连接。",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatCommandVisibility(config) {
  const enabled = config.handoff?.showCommands === true;
  return [
    `Command display: ${enabled ? "on" : "off"}`,
    enabled
      ? "Normal commands and one-line output summaries will be sent to Feishu/Lark."
      : "Normal commands and Output are hidden. Risky commands are still shown with a warning.",
    "",
    "Use commands on or commands off.",
  ].join("\n");
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

function rememberLarkMessage(ctx, messageId) {
  if (!messageId) return false;
  if (!ctx.seenMessageIds) ctx.seenMessageIds = new Map();
  if (ctx.seenMessageIds.has(messageId)) return true;

  ctx.seenMessageIds.set(messageId, Date.now());
  if (ctx.seenMessageIds.size > 1000) {
    const stale = [...ctx.seenMessageIds.entries()]
      .sort((left, right) => left[1] - right[1])
      .slice(0, 200);
    for (const [id] of stale) ctx.seenMessageIds.delete(id);
  }
  return false;
}
