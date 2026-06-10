import fs from "node:fs/promises";
import { ensureDir, newId, nowIso, queueFilePath } from "./config.mjs";

const EMPTY_DB = { version: 1, commands: [], events: [] };

export class RemoteCommandQueue {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.filePath = queueFilePath(dataDir);
    this.mutationChain = Promise.resolve();
  }

  async enqueue(input) {
    return this.#mutate((db) => {
      const now = nowIso();
      const command = {
        id: input.id || newId(),
        source: input.source || "lark",
        mode: input.mode || "worktree",
        presentation: input.presentation || (input.mode === "thread_handoff" ? "chat" : "task"),
        notifyQueued: input.notifyQueued === true,
        notifyStarted: input.notifyStarted === true,
        controlWindowCommand: input.controlWindowCommand === true,
        targetWindowDispatch: input.targetWindowDispatch === true,
        handoffGuidance: input.handoffGuidance === true,
        handoffDispatch: input.handoffDispatch === true,
        dispatchTarget: input.dispatchTarget || null,
        parentRemoteCommandId: input.parentRemoteCommandId || "",
        takeoverState: input.takeoverState || "",
        guidanceForCommandId: input.guidanceForCommandId || "",
        repoKey: input.repoKey,
        projectRoot: input.projectRoot,
        prompt: input.prompt,
        normalizedTask: input.normalizedTask || input.prompt,
        status: "pending",
        chatIdHash: input.chatIdHash || "",
        messageId: input.messageId || "",
        userIdHash: input.userIdHash || "",
        userName: input.userName || "lark_user",
        worktreePath: "",
        branchName: "",
        codexSessionId: input.codexSessionId || "",
        codexSessionPath: input.codexSessionPath || "",
        result: "",
        diffSummary: "",
        testSummary: "",
        error: "",
        createdAt: now,
        claimedAt: "",
        completedAt: "",
        approvedActions: [],
      };
      db.commands.push(command);
      db.events.push(eventFor(command.id, "queued", { repoKey: command.repoKey }));
      return command;
    });
  }

  async list({ limit = 20 } = {}) {
    const db = await this.#read();
    return db.commands.slice().reverse().slice(0, limit);
  }

  async get(id) {
    const db = await this.#read();
    return db.commands.find((command) => command.id === id) || null;
  }

  async findByMessageId(messageId) {
    if (!messageId) return null;
    const db = await this.#read();
    return db.commands.find((command) => command.messageId === messageId) || null;
  }

  async counts() {
    const db = await this.#read();
    const counts = {};
    for (const command of db.commands) {
      counts[command.status] = (counts[command.status] || 0) + 1;
    }
    return counts;
  }

  async claimNext(options = {}) {
    const claim = claimMetadata(options);
    return this.#mutate((db) => {
      const pending = db.commands.filter((item) => item.status === "pending");
      const eligible = pending.filter((item) => !isTargetDispatchBlockedByRunning(db, item));
      const command = eligible.find((item) => item.controlWindowCommand) || eligible[0];
      if (!command) return null;
      command.status = "running";
      Object.assign(command, claim);
      db.events.push(eventFor(command.id, "claimed", {}));
      return command;
    });
  }

  async claimNextMatching(predicate, options = {}) {
    if (typeof predicate !== "function") return null;
    const claim = claimMetadata(options);
    return this.#mutate((db) => {
      const command = db.commands.find((item) =>
        item.status === "pending"
        && predicate(item)
        && !isTargetDispatchBlockedByRunning(db, item)
      );
      if (!command) return null;
      command.status = "running";
      Object.assign(command, claim);
      db.events.push(eventFor(command.id, "claimed", {}));
      return command;
    });
  }

  async update(id, patch, eventKind = "updated") {
    return this.#mutate((db) => {
      const command = db.commands.find((item) => item.id === id);
      if (!command) return null;
      Object.assign(command, patch);
      db.events.push(eventFor(id, eventKind, patch));
      return command;
    });
  }

  async heartbeat(id, input = {}) {
    return this.#mutate((db) => {
      const command = db.commands.find((item) => item.id === id);
      if (!command || command.status !== "running") return command || null;
      command.runnerHeartbeatAt = input.at || nowIso();
      if (input.runnerPid) command.runnerPid = input.runnerPid;
      if (input.runnerId) command.runnerId = input.runnerId;
      return command;
    });
  }

  async recoverStaleRunning(input = {}) {
    const staleMs = Number(input.staleMs || 0);
    if (!Number.isFinite(staleMs) || staleMs <= 0) return [];
    const now = input.now || nowIso();
    const nowMs = Date.parse(now);
    const recovered = [];
    return this.#mutate((db) => {
      for (const command of db.commands) {
        if (command.status !== "running") continue;
        const heartbeatAt = command.runnerHeartbeatAt || command.claimedAt || command.createdAt || "";
        const heartbeatMs = Date.parse(heartbeatAt);
        const runnerPid = Number(command.runnerPid || 0);
        const stale = Number.isFinite(nowMs) && Number.isFinite(heartbeatMs) && nowMs - heartbeatMs > staleMs;
        const ownerGone = runnerPid > 0 && !isProcessAlive(runnerPid);
        if (!stale && !ownerGone) continue;

        const language = input.language === "en" ? "en" : "zh";
        const reason = input.reason || (language === "en"
          ? "Lark Remote runner was interrupted before this command finished."
          : "Lark Remote 执行器中断，命令未完成。");
        command.status = command.targetWindowDispatch ? "failed" : "blocked_retryable";
        command.error = reason;
        command.completedAt = now;
        db.events.push(eventFor(command.id, "stale_running_recovered", {
          reason,
          previousRunnerPid: command.runnerPid || "",
          previousHeartbeatAt: heartbeatAt,
        }));
        recovered.push({ ...command });
      }
      return recovered;
    });
  }

  async cancel(id, reason = "cancelled by user") {
    return this.#mutate((db) => {
      const command = db.commands.find((item) => item.id === id);
      if (!command) return null;
      if (!["pending", "running", "waiting_review"].includes(command.status)) return command;
      command.status = "cancelled";
      command.error = reason;
      command.completedAt = nowIso();
      db.events.push(eventFor(id, "cancelled", { reason }));
      return command;
    });
  }

  async approve(id, action) {
    return this.#mutate((db) => {
      const command = db.commands.find((item) => item.id === id);
      if (!command) return null;
      command.approvedActions = [...new Set([...(command.approvedActions || []), action])];
      db.events.push(eventFor(id, "approved", { action }));
      return command;
    });
  }

  async events(id, { limit = 50 } = {}) {
    const db = await this.#read();
    return db.events.filter((event) => event.commandId === id).slice(-limit);
  }

  async #mutate(fn) {
    const run = async () => {
      const db = await this.#read();
      const result = fn(db);
      await this.#write(db);
      return result;
    };
    const next = this.mutationChain.then(run, run);
    this.mutationChain = next.catch(() => {});
    return next;
  }

  async #read() {
    await ensureDir(this.dataDir);
    try {
      const text = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(text);
      return {
        version: parsed.version || 1,
        commands: Array.isArray(parsed.commands) ? parsed.commands : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
      };
    } catch (error) {
      if (error.code === "ENOENT") return structuredClone(EMPTY_DB);
      throw error;
    }
  }

  async #write(db) {
    await ensureDir(this.dataDir);
    const tmp = `${this.filePath}.${process.pid}.${newId("tmp")}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(db, null, 2)}\n`);
    await fs.rename(tmp, this.filePath);
  }
}

function eventFor(commandId, kind, payload) {
  return {
    id: newId("evt"),
    commandId,
    kind,
    payload,
    createdAt: nowIso(),
  };
}

function claimMetadata(input = {}) {
  const at = nowIso();
  return {
    claimedAt: at,
    runnerHeartbeatAt: at,
    runnerPid: input.runnerPid || process.pid,
    runnerId: input.runnerId || "",
  };
}

function isTargetDispatchBlockedByRunning(db, command) {
  if (!command?.targetWindowDispatch || !command.codexSessionId) return false;
  return db.commands.some((item) =>
    item !== command
    && item.status === "running"
    && item.targetWindowDispatch === true
    && item.codexSessionId === command.codexSessionId
  );
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
