#!/usr/bin/env node
import readline from "node:readline";
import { readPackageVersion } from "../src/config.mjs";
import { bridgeFetch, bridgeStatus, readBridgeState, startBridgeProcess, stopBridgeProcess } from "../src/supervisor.mjs";

const tools = [
  {
    name: "codex_lark_status",
    description: "Return Codex Lark Remote bridge, queue, and runner status.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string", description: "Optional data directory override." },
        configPath: { type: "string", description: "Optional config file path override." },
      },
    },
  },
  {
    name: "codex_lark_start",
    description: "Start the local Codex Lark Remote bridge process.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "codex_lark_stop",
    description: "Stop the local Codex Lark Remote bridge process.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "codex_lark_task",
    description: "Return one Codex Lark Remote task by id.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "codex_lark_history",
    description: "Return recent Codex Lark Remote tasks.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 20 },
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "codex_lark_send",
    description: "Create a Codex Lark Remote task manually through the running bridge. Useful for local testing without Feishu/Lark.",
    inputSchema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string" },
        repoKey: { type: "string" },
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "codex_lark_cancel",
    description: "Cancel a pending, running, or waiting_review Codex Lark Remote task.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "codex_lark_approve",
    description: "Approve a gated Codex Lark Remote action such as test, commit, or push.",
    inputSchema: {
      type: "object",
      required: ["id", "action"],
      properties: {
        id: { type: "string" },
        action: { type: "string", enum: ["test", "commit", "push", "review"] },
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
let chain = Promise.resolve();

rl.on("line", (line) => {
  if (!line.trim()) return;
  chain = chain.then(() => handleLine(line));
});

async function handleLine(line) {
  let request;
  try {
    request = JSON.parse(line);
    const result = await handleRequest(request);
    if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request?.id ?? null,
        error: { code: -32000, message: error.message },
      })}\n`,
    );
  }
}

async function handleRequest(request) {
  if (request.method === "notifications/initialized") return null;
  if (request.method === "initialize") {
    const version = await readPackageVersion();
    return response(request.id, {
      protocolVersion: request.params?.protocolVersion || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "codex-lark-remote", version },
    });
  }
  if (request.method === "tools/list") return response(request.id, { tools });
  if (request.method === "tools/call") {
    const name = request.params?.name;
    const args = request.params?.arguments || {};
    return response(request.id, await callTool(name, args));
  }
  return response(request.id, {});
}

async function callTool(name, args) {
  if (name === "codex_lark_start") {
    return textContent(formatStatus(await startBridgeProcess(args)));
  }
  if (name === "codex_lark_stop") {
    return textContent(formatJson(await stopBridgeProcess(args)));
  }
  if (name === "codex_lark_status") {
    return textContent(formatStatus(await bridgeStatus(args)));
  }

  const state = await readBridgeState(args);
  if (!state?.url || !state?.token) {
    return {
      isError: true,
      content: [{ type: "text", text: "Codex Lark Remote bridge is not running. Use codex_lark_start first." }],
    };
  }

  if (name === "codex_lark_history") {
    const limit = Number(args.limit || 20);
    return textContent(formatJson(await bridgeFetch(state, `/bridge/tasks?limit=${limit}`)));
  }
  if (name === "codex_lark_send") {
    return textContent(
      formatJson(
        await bridgeFetch(state, "/bridge/tasks", {
          method: "POST",
          body: { prompt: args.prompt, repoKey: args.repoKey },
        }),
      ),
    );
  }
  if (name === "codex_lark_task") {
    return textContent(formatJson(await bridgeFetch(state, `/bridge/tasks/${encodeURIComponent(args.id)}`)));
  }
  if (name === "codex_lark_cancel") {
    return textContent(
      formatJson(
        await bridgeFetch(state, `/bridge/tasks/${encodeURIComponent(args.id)}/cancel`, {
          method: "POST",
        }),
      ),
    );
  }
  if (name === "codex_lark_approve") {
    return textContent(
      formatJson(
        await bridgeFetch(state, `/bridge/tasks/${encodeURIComponent(args.id)}/approve`, {
          method: "POST",
          body: { action: args.action || "review" },
        }),
      ),
    );
  }
  return {
    isError: true,
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
  };
}

function formatStatus(status) {
  if (status.data?.text) return status.data.text;
  return formatJson(status);
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function response(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function textContent(text) {
  return { content: [{ type: "text", text }] };
}
