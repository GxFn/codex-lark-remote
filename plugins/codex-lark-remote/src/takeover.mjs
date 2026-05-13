import fs from "node:fs/promises";
import { activateHandoff } from "./handoff.mjs";
import { ensureDir, nowIso, resolveDataDir, takeoverFilePath } from "./config.mjs";
import { listCodexThreads, findCodexThreadById } from "./handoff.mjs";

const FINAL_EVENT_RE = /(?:turn[./_-]?completed|response[./_-]?completed|final_answer|agent_message)/i;
const RUNNING_EVENT_RE = /(?:tool_call|command|exec|turn[./_-]?started|response[./_-]?started|agent_reasoning|agent_progress)/i;

export async function readTakeover(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  try {
    const state = JSON.parse(await fs.readFile(takeoverFilePath(dataDir), "utf8"));
    if (!state || state.state === "none" || state.state === "cancelled") return null;
    return state;
  } catch {
    return null;
  }
}

export async function prepareTakeoverScope(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  await ensureDir(dataDir);
  const now = nowIso();
  const state = {
    version: 1,
    state: "selecting",
    scope: {
      cwd: options.cwd || "",
      startedByThreadId: options.threadId || "",
      startedByThreadPath: options.threadPath || "",
      startedAt: now,
      startedBy: options.startedBy || "mcp",
    },
    selection: emptySelection(),
    target: null,
    lark: {},
    pendingInputs: [],
    activatedAt: "",
    deactivatedAt: "",
    lastSeenStatus: "",
    lastSeenAt: "",
  };
  await writeTakeover({ dataDir }, state);
  return state;
}

export async function clearTakeover(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const previous = await readTakeover({ dataDir });
  await ensureDir(dataDir);
  const state = {
    version: 1,
    state: "cancelled",
    deactivatedAt: nowIso(),
    previousThreadId: previous?.target?.threadId || "",
  };
  await fs.writeFile(takeoverFilePath(dataDir), `${JSON.stringify(state, null, 2)}\n`);
  return { state: "cancelled", previous };
}

export async function listTakeoverTargets(options = {}) {
  const state = await readTakeover(options);
  const scope = state?.scope || {};
  const cwd = options.cwd || scope.cwd || "";
  const excludeThreadId = options.excludeThreadId || scope.startedByThreadId || "";
  const limit = Number(options.limit || 10);
  const candidates = await listCodexThreads({
    ...options,
    cwd,
    limit: Math.max(limit + 5, limit),
  });
  const filtered = [];
  for (const thread of candidates) {
    if (excludeThreadId && thread.threadId === excludeThreadId) continue;
    const status = await detectSessionStatus(thread.threadPath, {
      idleDebounceMs: options.idleDebounceMs,
    });
    filtered.push({
      ...thread,
      status: status.status,
      statusReason: status.reason,
      lastEventAtMs: status.lastEventAtMs || thread.updatedAtMs || 0,
    });
    if (filtered.length >= limit) break;
  }
  return filtered;
}

export async function refreshTakeoverSelection(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const state = await readTakeover({ dataDir }) || await prepareTakeoverScope(options);
  const targets = await listTakeoverTargets({
    ...options,
    dataDir,
    cwd: options.cwd || state.scope?.cwd || "",
    excludeThreadId: state.scope?.startedByThreadId || options.excludeThreadId || "",
    idleDebounceMs: options.idleDebounceMs,
  });
  const now = Date.now();
  const updated = {
    ...state,
    state: "selecting",
    selection: {
      listedAt: nowIso(),
      expiresAt: new Date(now + Number(options.selectionTtlMs || 10 * 60 * 1000)).toISOString(),
      options: targets.map((target, index) => optionForTarget(target, index + 1)),
    },
    target: null,
    lastSeenAt: nowIso(),
  };
  await writeTakeover({ dataDir }, updated);
  return { state: updated, targets };
}

export async function selectTakeoverTarget(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const state = await ensureTakeoverState(options);
  const target = await resolveTakeoverTarget({
    ...options,
    dataDir,
    state,
  });
  const updated = {
    ...state,
    state: "selected",
    target: {
      ...target,
      selectedAt: nowIso(),
      selectedBy: options.selectedBy || "lark",
    },
    lark: mergeLarkState(state.lark, options),
    lastSeenStatus: target.status || "",
    lastSeenAt: nowIso(),
  };
  await writeTakeover({ dataDir }, updated);
  return { state: updated, target };
}

export async function executeTakeoverTarget(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  let state = await ensureTakeoverState(options);
  let target = options.target || state.target;
  if (!target || options.selector || options.threadId || options.optionIndex) {
    const selected = await selectTakeoverTarget({
      ...options,
      dataDir,
      selectedBy: options.selectedBy || "lark",
    });
    state = selected.state;
    target = selected.target;
  }
  const fresh = await refreshTargetStatus(target, options);
  const updatedTarget = { ...target, ...fresh };

  if (updatedTarget.status === "running" || updatedTarget.status === "unknown") {
    const pending = {
      ...state,
      state: "pending",
      target: {
        ...updatedTarget,
        selectedAt: state.target?.selectedAt || nowIso(),
        selectedBy: state.target?.selectedBy || options.selectedBy || "lark",
      },
      lark: mergeLarkState(state.lark, options),
      lastSeenStatus: updatedTarget.status,
      lastSeenAt: nowIso(),
    };
    await writeTakeover({ dataDir }, pending);
    return { state: pending, target: pending.target, handoff: null, pending: true };
  }

  const handoff = await activateHandoff({
    dataDir,
    threadId: updatedTarget.threadId,
    threadPath: updatedTarget.threadPath,
    cwd: updatedTarget.cwd,
    name: updatedTarget.name,
    requireExplicitThread: true,
    activatedBy: options.activatedBy || "takeover",
  });
  const active = {
    ...state,
    state: "active",
    target: updatedTarget,
    lark: mergeLarkState(state.lark, options),
    activatedAt: nowIso(),
    lastSeenStatus: "idle",
    lastSeenAt: nowIso(),
  };
  await writeTakeover({ dataDir }, active);
  return { state: active, target: updatedTarget, handoff, pending: false };
}

export async function appendPendingTakeoverInput(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const state = await readTakeover({ dataDir });
  if (!state || state.state !== "pending") return null;
  const max = Number(options.maxPendingInputs || 20);
  const pendingInputs = Array.isArray(state.pendingInputs) ? state.pendingInputs.slice() : [];
  if (pendingInputs.length >= max) {
    return { ...state, overflow: true };
  }
  pendingInputs.push({
    messageId: options.messageId || "",
    text: options.text || "",
    createdAt: nowIso(),
  });
  const updated = {
    ...state,
    pendingInputs,
    lark: mergeLarkState(state.lark, options),
    lastSeenAt: nowIso(),
  };
  await writeTakeover({ dataDir }, updated);
  return updated;
}

export async function activatePendingTakeoverIfIdle(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const state = await readTakeover({ dataDir });
  if (!state || state.state !== "pending" || !state.target?.threadId) return null;
  const target = await refreshTargetStatus(state.target, options);
  if (target.status !== "idle") {
    const updated = {
      ...state,
      target: { ...state.target, ...target },
      lastSeenStatus: target.status,
      lastSeenAt: nowIso(),
    };
    await writeTakeover({ dataDir }, updated);
    return { activated: false, state: updated };
  }
  const result = await executeTakeoverTarget({
    ...options,
    dataDir,
    target: { ...state.target, ...target },
    activatedBy: "takeover-watcher",
  });
  return { activated: true, ...result };
}

export function buildPendingTakeoverPrompt(inputs = []) {
  const items = inputs
    .map((item, index) => `${index + 1}. ${String(item.text || "").trim()}`)
    .filter((line) => !/^\d+\.\s*$/.test(line));
  if (!items.length) return "";
  return [
    "[Messages received while takeover was waiting for the current Codex turn to finish]",
    "",
    ...items,
  ].join("\n");
}

export async function detectSessionStatus(sessionPath, options = {}) {
  if (!sessionPath) return { status: "unknown", reason: "missing session path" };
  let stat;
  try {
    stat = await fs.stat(sessionPath);
  } catch {
    return { status: "unknown", reason: "session file unavailable" };
  }
  const last = await readLastJsonRecord(sessionPath);
  const statusFromEvent = statusFromRecord(last);
  if (statusFromEvent) {
    return {
      status: statusFromEvent,
      reason: `last event ${statusFromEvent}`,
      lastEventAtMs: stat.mtimeMs,
    };
  }
  const idleDebounceMs = Number(options.idleDebounceMs || 3000);
  if (Date.now() - stat.mtimeMs < idleDebounceMs) {
    return { status: "running", reason: "recent session write", lastEventAtMs: stat.mtimeMs };
  }
  return { status: "idle", reason: "session file stable", lastEventAtMs: stat.mtimeMs };
}

async function ensureTakeoverState(options = {}) {
  const existing = await readTakeover(options);
  if (existing) return existing;
  return prepareTakeoverScope(options);
}

async function resolveTakeoverTarget(options = {}) {
  const state = options.state || await readTakeover(options);
  const selector = String(options.selector || options.threadId || options.optionIndex || "").trim();
  const selectionOptions = Array.isArray(state?.selection?.options) ? state.selection.options : [];

  if (selector && /^\d+$/.test(selector)) {
    const option = selectionOptions.find((item) => Number(item.index) === Number(selector));
    if (option) return refreshTargetStatus(option, options);
  }
  if (options.threadId) {
    const exact = selectionOptions.find((item) => item.threadId === options.threadId);
    if (exact) return refreshTargetStatus(exact, options);
  }

  const candidates = selectionOptions.length
    ? selectionOptions
    : await listTakeoverTargets({
        ...options,
        cwd: options.cwd || state?.scope?.cwd || "",
        excludeThreadId: state?.scope?.startedByThreadId || "",
      });

  if (!selector && candidates.length === 1) return refreshTargetStatus(candidates[0], options);
  if (!selector) throw new Error("Select a Codex window first.");

  const lower = selector.toLowerCase();
  const matches = candidates.filter((thread) =>
    String(thread.threadId || "").toLowerCase().startsWith(lower)
    || String(thread.threadId || "").toLowerCase() === lower
    || (thread.name && thread.name.toLowerCase().includes(lower))
  );
  if (matches.length === 1) return refreshTargetStatus(matches[0], options);
  if (matches.length > 1) throw new Error(`Takeover selector is ambiguous: ${selector}`);

  const byId = await findCodexThreadById(selector, options);
  if (byId) return refreshTargetStatus(byId, options);
  throw new Error(`No Codex window matched: ${selector}`);
}

async function refreshTargetStatus(target, options = {}) {
  const status = await detectSessionStatus(target.threadPath, options);
  return {
    ...target,
    status: status.status,
    statusReason: status.reason,
    lastEventAtMs: status.lastEventAtMs || target.lastEventAtMs || target.updatedAtMs || 0,
  };
}

async function writeTakeover(options, state) {
  const dataDir = resolveDataDir(options.dataDir);
  await ensureDir(dataDir);
  await fs.writeFile(takeoverFilePath(dataDir), `${JSON.stringify(state, null, 2)}\n`);
}

function emptySelection() {
  return { listedAt: "", expiresAt: "", options: [] };
}

function optionForTarget(target, index) {
  return {
    index,
    threadId: target.threadId,
    threadPath: target.threadPath || "",
    cwd: target.cwd || "",
    name: target.name || "",
    status: target.status || "unknown",
    statusReason: target.statusReason || "",
    updatedAtMs: target.updatedAtMs || 0,
    lastEventAtMs: target.lastEventAtMs || 0,
  };
}

function mergeLarkState(previous = {}, options = {}) {
  return {
    ...(previous || {}),
    messageId: options.messageId || previous?.messageId || "",
    chatIdHash: options.chatIdHash || previous?.chatIdHash || "",
    userIdHash: options.userIdHash || previous?.userIdHash || "",
  };
}

async function readLastJsonRecord(filePath) {
  try {
    const stat = await fs.stat(filePath);
    const length = Math.min(stat.size, 256 * 1024);
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, stat.size - length);
      const lines = buffer.toString("utf8").split(/\r?\n/).filter(Boolean).reverse();
      for (const line of lines) {
        try {
          return JSON.parse(line);
        } catch {
          // Try the previous line.
        }
      }
      return null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

function statusFromRecord(record) {
  if (!record || record.type === "session_meta") return "";
  const payload = record.payload || {};
  const item = record.item || payload.item || payload || {};
  const typeText = [
    record.type,
    record.method,
    payload.type,
    payload.phase,
    item.type,
    item.phase,
    item.status,
  ].filter(Boolean).join(" ");

  const text = `${typeText} ${JSON.stringify({
    message: payload.message || item.message || "",
    role: item.role || payload.role || "",
  })}`;
  if (/final_answer/i.test(text)) return "idle";
  if (/turn[./_-]?completed|response[./_-]?completed/i.test(text)) return "idle";
  if (item.type === "agent_message" || item.type === "message") {
    if (item.phase === "final_answer" || payload.phase === "final_answer") return "idle";
  }
  if (RUNNING_EVENT_RE.test(text) && !FINAL_EVENT_RE.test(text)) return "running";
  return "";
}
