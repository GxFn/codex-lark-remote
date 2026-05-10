import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig, stateFilePath } from "./config.mjs";

export async function readBridgeState(options = {}) {
  const config = await loadConfig(options);
  try {
    return JSON.parse(await fs.readFile(stateFilePath(config.dataDir), "utf8"));
  } catch {
    return null;
  }
}

export async function bridgeStatus(options = {}) {
  const config = await loadConfig(options);
  const state = await readBridgeState(options);
  if (!state?.url || !state?.token) {
    return { running: false, message: "Bridge is not running", config };
  }
  try {
    const data = await bridgeFetch(state, "/bridge/status");
    return { running: true, state, config, ...data };
  } catch (error) {
    return { running: false, state, config, message: error.message };
  }
}

export async function startBridgeProcess(options = {}) {
  const current = await bridgeStatus(options);
  if (current.running) return current;

  const config = await loadConfig(options);
  const bridgeUrl = new URL("../bin/codex-lark-bridge.mjs", import.meta.url);
  const child = spawn(process.execPath, [bridgeUrl.pathname, "--port", "0"], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      CODEX_LARK_DATA_DIR: config.dataDir,
      ...(options.configPath ? { CODEX_LARK_CONFIG: options.configPath } : {}),
    },
  });
  child.unref();

  for (let attempt = 0; attempt < 25; attempt += 1) {
    await delay(200);
    const status = await bridgeStatus(options);
    if (status.running) return status;
  }
  return { running: false, message: "Bridge start timed out", config };
}

export async function stopBridgeProcess(options = {}) {
  const state = await readBridgeState(options);
  if (!state?.url || !state?.token) return { success: true, message: "Bridge is not running" };
  try {
    return bridgeFetch(state, "/bridge/stop", { method: "POST" });
  } catch (error) {
    if (state.pid) {
      try {
        process.kill(state.pid, "SIGTERM");
        return { success: true, message: "Bridge process signalled" };
      } catch {
        return { success: false, error: error.message };
      }
    }
    return { success: false, error: error.message };
  }
}

export async function bridgeFetch(state, route, options = {}) {
  const response = await fetch(`${state.url}${route}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${state.token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

