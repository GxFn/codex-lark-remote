#!/usr/bin/env node
import readline from "node:readline";
import { applyCodexContext } from "../src/codex-context.mjs";
import { formatConfigUpdate, updateRuntimeConfig } from "../src/config-writer.mjs";
import { loadConfig, readPackageVersion } from "../src/config.mjs";
import { diagnoseLarkRemote, formatDiagnostics, formatHandoff } from "../src/diagnostics.mjs";
import { LarkNotifier } from "../src/notifier.mjs";
import { formatSetupVerification } from "../src/presenter.mjs";
import { sanitizeBridgeStatus } from "../src/sanitize.mjs";
import { formatMissingLarkCredentials, hasLarkAppCredentials } from "../src/setup-guide.mjs";
import { verifyLarkSetup } from "../src/setup-verification.mjs";
import { bridgeFetch, bridgeStatus, readBridgeState, startBridgeProcess, stopBridgeProcess } from "../src/supervisor.mjs";

const tools = [
  {
    name: "lark_configure",
    description: "Write or update ~/.codex-lark-remote/config.json from Feishu/Lark setup details supplied in the Codex chat. Returns a sanitized summary and never prints secrets.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string", description: "Optional data directory override." },
        configPath: { type: "string", description: "Optional config file path override." },
        publicUrl: { type: "string", description: "Advanced: public callback URL." },
        defaultRepo: { type: "string", description: "Advanced: default repo key for isolated tasks." },
        lark: {
          type: "object",
          properties: {
            domain: {
              type: "string",
              description: "Feishu/Lark OpenAPI domain. Use 'feishu' for https://open.feishu.cn or 'lark' for https://open.larksuite.com. A full custom https URL is also accepted.",
            },
            baseUrl: {
              type: "string",
              description: "Advanced: explicit OpenAPI base URL. Overrides domain.",
            },
            appId: { type: "string" },
            appSecret: { type: "string" },
            verificationToken: { type: "string" },
            encryptKey: { type: "string" },
            allowedUsers: { type: "array", items: { type: "string" } },
            transport: { type: "string", enum: ["websocket", "webhook"] },
            websocket: { type: "boolean" },
          },
        },
        repos: {
          type: "object",
          description: "Advanced: repo map for isolated tasks.",
          additionalProperties: {
            type: "object",
            properties: {
              path: { type: "string" },
              remote: { type: "string" },
              baseBranch: { type: "string" },
              testCommand: { type: "string" },
            },
          },
        },
        runner: { type: "object" },
        handoff: { type: "object" },
        takeover: { type: "object" },
        startup: { type: "object" },
        intent: { type: "object" },
        policy: { type: "object" },
      },
    },
  },
  {
    name: "lark_get_bridge_status",
    description: "Return Lark Remote bridge, queue, and runner status.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string", description: "Optional data directory override." },
        configPath: { type: "string", description: "Optional config file path override." },
      },
    },
  },
  {
    name: "lark_check_auth",
    description: "Check whether configured Feishu/Lark app credentials can acquire a tenant access token. Does not print secrets.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "lark_verify_setup",
    description: "Verify first-run Feishu/Lark long-connection setup: App credentials, local bridge, WebSocket connection, and the event/callback checks the user should run in Feishu Open Platform.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
        checkAuth: { type: "boolean", description: "Also call Feishu/Lark auth API. Defaults to true." },
        startBridge: { type: "boolean", description: "Start or reuse the local bridge before checking WebSocket status. Defaults to true." },
      },
    },
  },
  {
    name: "lark_diagnose",
    description: "Return a sanitized readiness checklist for continuing the current Codex conversation from Feishu/Lark.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
        checkAuth: { type: "boolean", description: "Also call Feishu/Lark auth API. Defaults to false." },
        json: { type: "boolean", description: "Return raw JSON instead of a compact text checklist." },
      },
    },
  },
  {
    name: "lark_start",
    description: "Advanced setup-only: start the local bridge without attaching a control Codex window. For normal remote control, use lark_lock_control_window or lark_prepare_takeover.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "lark_lock_control_window",
    description: "Attach and lock this Codex conversation as the Lark Remote control window. Existing chat history is not sent to Feishu/Lark. Also stores the host thread capability snapshot for later dispatch.",
    inputSchema: {
      type: "object",
      required: ["confirmedLocalBridgeHandoff", "capabilities"],
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
        threadId: { type: "string", description: "Optional explicit Codex thread/session id. When omitted, Codex request metadata is used; the tool does not guess by workspace path." },
        cwd: { type: "string", description: "Optional workspace cwd used when resolving the current thread." },
        checkAuth: { type: "boolean", description: "Also call Feishu/Lark auth API. Defaults to false." },
        capabilities: {
          type: "object",
          description: "Silent capability snapshot confirmed by the current Codex window.",
          properties: {
            hostThreadSend: {
              type: "object",
              properties: {
                available: { type: "boolean" },
                tool: { type: "string" },
              },
            },
            hostThreadRead: {
              type: "object",
              properties: {
                available: { type: "boolean" },
                tool: { type: "string" },
              },
            },
            hostThreadInterrupt: {
              type: "object",
              properties: {
                available: { type: "boolean" },
                tool: { type: "string" },
              },
            },
          },
        },
        confirmedLocalBridgeHandoff: {
          type: "boolean",
          description: "Set true only after the user explicitly approved storing local thread routing for this conversation so Feishu/Lark can continue it through the local bridge.",
        },
      },
    },
  },
  {
    name: "lark_prepare_takeover",
    description: "Prepare Feishu/Lark-driven takeover from this Codex conversation. This starts the bridge, attaches this conversation as the control window, and stores local takeover routing state; allowed Feishu/Lark users choose the project and window to inspect or take over.",
    inputSchema: {
      type: "object",
      required: ["confirmedLocalBridgeHandoff", "capabilities"],
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
        cwd: { type: "string", description: "Optional workspace cwd used when resolving takeover targets." },
        capabilities: {
          type: "object",
          description: "Silent control-window host thread capability snapshot.",
        },
        confirmedLocalBridgeHandoff: {
          type: "boolean",
          description: "Set true only after the user explicitly approved storing local takeover routing scope for this project.",
        },
      },
    },
  },
  {
    name: "lark_list_projects",
    description: "List Codex projects discovered from local Codex session records so the control Codex window can decide project/window routing itself.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
        limit: { type: "number", default: 20 },
        page: { type: "number", default: 0 },
        pageSize: { type: "number", default: 3 },
      },
    },
  },
  {
    name: "lark_select_project",
    description: "Select a Codex project by list number, cwd, or name fragment and return that project's takeover-ready Codex windows.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
        selector: { type: "string", description: "Project option number, cwd, or project name fragment." },
        cwd: { type: "string", description: "Exact project cwd to select." },
        projectIndex: { type: "number", description: "Project option number." },
        limit: { type: "number", default: 10 },
        pageSize: { type: "number", default: 3 },
      },
    },
  },
  {
    name: "lark_list_project_sessions",
    description: "List Codex windows for a chosen project cwd. Feishu/Lark normally starts from the project list, then enters a project before choosing a window.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
        cwd: { type: "string" },
        limit: { type: "number", default: 10 },
      },
    },
  },
  {
    name: "lark_select_target",
    description: "Select a Codex window as the pending Lark Remote target without confirming takeover.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
        selector: { type: "string", description: "Target option number, thread id prefix, or title fragment." },
        threadId: { type: "string" },
        optionIndex: { type: "number" },
      },
    },
  },
  {
    name: "lark_confirm_takeover",
    description: "Confirm takeover for a selected Codex window so future Feishu/Lark work messages can be dispatched to it.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
        selector: { type: "string", description: "Target option number, thread id prefix, or title fragment." },
        threadId: { type: "string" },
        optionIndex: { type: "number" },
      },
    },
  },
  {
    name: "lark_clear_active_target",
    description: "Clear the current selected/active dispatch target while keeping the Lark bridge and control Codex window connected.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "lark_list_observation_targets",
    description: "List observable local Codex sessions for read-only progress streaming.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
        cwd: { type: "string" },
        limit: { type: "number", default: 10 },
      },
    },
  },
  {
    name: "lark_start_observation",
    description: "Start read-only observation for a Codex session. Pass remoteCommandId from the current Lark Remote prompt so the stream can be anchored to the current Feishu/Lark message.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
        selector: { type: "string", description: "Session option number, thread id prefix, or title fragment." },
        threadId: { type: "string" },
        cwd: { type: "string" },
        remoteCommandId: { type: "string", description: "Current Lark Remote command id shown in the control-window prompt." },
        messageId: { type: "string", description: "Advanced: explicit Feishu/Lark message id to anchor replies." },
        language: { type: "string", enum: ["zh", "en"] },
      },
    },
  },
  {
    name: "lark_stop_observation",
    description: "Stop the current read-only observation stream.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "lark_unlock_control_window",
    description: "Detach the current control Codex window from the Lark bridge while keeping the bridge process available.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "lark_stop",
    description: "Stop the local Lark Remote bridge process.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "lark_get_remote_command",
    description: "Return one queued Lark Remote command by id.",
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
    name: "lark_list_remote_commands",
    description: "Return recent Lark Remote commands.",
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
    name: "lark_cancel_remote_command",
    description: "Cancel a pending, running, or waiting command.",
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
    name: "lark_route_remote_command",
    description: "Required first MCP for every Lark Remote control-window prompt containing remoteCommandId. Returns the exact action, nextTool, toolInput, and completion tool; follow it before any dispatch or control action.",
    inputSchema: {
      type: "object",
      required: ["remoteCommandId"],
      properties: {
        remoteCommandId: { type: "string" },
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "lark_prepare_dispatch",
    description: "Low-level target dispatch preparation. Do not call as the first step for control-window prompts; use lark_route_remote_command first and call this only when the router or diagnostics require it.",
    inputSchema: {
      type: "object",
      required: ["remoteCommandId"],
      properties: {
        remoteCommandId: { type: "string" },
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "lark_record_dispatch",
    description: "Required completion tool after a control window uses a host thread tool for target dispatch. This is the only success/failure signal for active-target delivery.",
    inputSchema: {
      type: "object",
      required: ["remoteCommandId", "status"],
      properties: {
        remoteCommandId: { type: "string" },
        status: { type: "string", enum: ["sent", "dispatch_sent", "blocked", "blocked_retryable", "waiting_clarification", "failed"] },
        targetThreadId: { type: "string" },
        targetTitle: { type: "string" },
        hostTool: { type: "string" },
        readbackOk: { type: "boolean" },
        evidence: { type: "string" },
        error: { type: "string" },
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "lark_request_clarification",
    description: "Required completion tool when a routed remote command needs user clarification, such as missing target session or ambiguous intent.",
    inputSchema: {
      type: "object",
      required: ["remoteCommandId", "question"],
      properties: {
        remoteCommandId: { type: "string" },
        question: { type: "string" },
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "lark_reply_remote_command",
    description: "Required completion tool for non-dispatch routed control actions. Sends one concise Feishu/Lark reply and marks the remote command handled.",
    inputSchema: {
      type: "object",
      required: ["remoteCommandId", "text"],
      properties: {
        remoteCommandId: { type: "string" },
        text: { type: "string" },
        status: { type: "string", enum: ["completed", "control_completed", "blocked", "blocked_retryable", "failed"] },
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
      serverInfo: { name: "lark-remote", version },
    });
  }
  if (request.method === "tools/list") return response(request.id, { tools });
  if (request.method === "tools/call") {
    const name = request.params?.name;
    const args = request.params?.arguments || {};
    return response(request.id, await callTool(name, args, request));
  }
  return response(request.id, {});
}

async function callTool(name, args, request = {}) {
  if (name === "lark_configure") {
    return textContent(formatConfigUpdate(await updateRuntimeConfig(args)));
  }
  if (name === "lark_start") {
    const config = await loadConfig(args);
    if (!hasLarkAppCredentials(config)) return textContent(formatMissingLarkCredentials(config));
    const bridge = await ensureBridge(args);
    if (!bridge.running) return textContent(formatBridgeStartFailure(bridge, "start"));
    return textContent(formatDiagnostics(await diagnoseLarkRemote(args)));
  }
  if (name === "lark_lock_control_window") {
    if (args.confirmedLocalBridgeHandoff !== true) {
      return textContent(formatHandoffConsentRequired());
    }
    const config = await loadConfig(args);
    if (!hasLarkAppCredentials(config)) {
      return textContent(formatHandoff(await diagnoseLarkRemote(args)));
    }
    const handoffArgs = applyCodexContext(args, request);
    if (!handoffArgs.threadId) {
      return textContent(formatMissingThreadContext());
    }
    const bridge = await ensureBridge(handoffArgs);
    const state = bridge.state || await readBridgeState(handoffArgs);
    if (!state?.url || !state?.token) {
      return textContent(formatBridgeStartFailure(bridge, "handoff"));
    }
    await bridgeFetch(state, "/bridge/handoff", {
      method: "POST",
      body: {
        threadId: handoffArgs.threadId,
        threadPath: handoffArgs.threadPath,
        cwd: handoffArgs.cwd,
        capabilities: args.capabilities,
        requireExplicitThread: true,
        activatedBy: "mcp",
      },
    });
    return textContent(formatHandoff(await diagnoseLarkRemote(handoffArgs)));
  }
  if (name === "lark_prepare_takeover") {
    if (args.confirmedLocalBridgeHandoff !== true) {
      return textContent(formatTakeoverConsentRequired());
    }
    const config = await loadConfig(args);
    if (!hasLarkAppCredentials(config)) {
      return textContent(formatHandoff(await diagnoseLarkRemote(args)));
    }
    const takeoverArgs = applyCodexContext(args, request);
    if (!takeoverArgs.threadId) {
      return textContent(formatMissingThreadContext());
    }
    if (!takeoverArgs.cwd) {
      return textContent("Lark Remote cannot prepare takeover because the current workspace cwd is unavailable.");
    }
    const bridge = await ensureBridge(takeoverArgs);
    const state = bridge.state || await readBridgeState(takeoverArgs);
    if (!state?.url || !state?.token) {
      return textContent(formatBridgeStartFailure(bridge, "takeover preparation"));
    }
    await bridgeFetch(state, "/bridge/handoff", {
      method: "POST",
      body: {
        threadId: takeoverArgs.threadId,
        threadPath: takeoverArgs.threadPath,
        cwd: takeoverArgs.cwd,
        capabilities: args.capabilities,
        requireExplicitThread: true,
        activatedBy: "mcp-takeover",
      },
    });
    await bridgeFetch(state, "/bridge/takeover/scope", {
      method: "POST",
      body: {
        threadId: takeoverArgs.threadId,
        threadPath: takeoverArgs.threadPath,
        cwd: takeoverArgs.cwd,
        startedBy: "mcp",
      },
    });
    return textContent([
      "Lark Remote takeover control is ready.",
      `Control window: ${String(takeoverArgs.threadId).slice(0, 8)}`,
      `Started from: ${takeoverArgs.cwd}`,
      "",
      "From Feishu/Lark, send /codex windows to choose a Codex project, then choose a window to observe or take over.",
    ].join("\n"));
  }
  if (name === "lark_stop") {
    return textContent(formatJson(await stopBridge(args)));
  }
  if (name === "lark_get_bridge_status") {
    return textContent(formatStatus(await bridgeStatus(args)));
  }
  if (name === "lark_check_auth") {
    const config = await loadConfig(args);
    const notifier = new LarkNotifier(config.lark || {});
    return textContent(formatJson(await notifier.checkAuth()));
  }
  if (name === "lark_verify_setup") {
    return textContent(formatSetupVerification(await verifyLarkSetup(args)));
  }
  if (name === "lark_diagnose") {
    const diagnostics = await diagnoseLarkRemote(args);
    return textContent(args.json ? formatJson(diagnostics) : formatDiagnostics(diagnostics));
  }

  const state = await readBridgeState(args);
  if (!state?.url || !state?.token) {
    const config = await loadConfig(args);
    if (!hasLarkAppCredentials(config)) {
      return {
        isError: true,
        content: [{ type: "text", text: formatMissingLarkCredentials(config) }],
      };
    }
    return {
      isError: true,
      content: [{ type: "text", text: formatBridgeStartFailure({ config }, "bridge request") }],
    };
  }

  if (name === "lark_list_remote_commands") {
    const limit = Number(args.limit || 20);
    return textContent(formatJson(await bridgeFetch(state, `/bridge/tasks?limit=${limit}`)));
  }
  if (name === "lark_list_projects") {
    const queryParams = new URLSearchParams();
    if (args.limit) queryParams.set("limit", String(Number(args.limit)));
    if (args.page) queryParams.set("page", String(Number(args.page)));
    if (args.pageSize) queryParams.set("pageSize", String(Number(args.pageSize)));
    const query = queryParams.toString() ? `?${queryParams}` : "";
    const result = await bridgeFetch(state, `/bridge/takeover/projects${query}`);
    return textContent(result.text || formatJson(result.data));
  }
  if (name === "lark_select_project") {
    const result = await bridgeFetch(state, "/bridge/takeover/project/select", {
      method: "POST",
      body: {
        selector: args.selector,
        cwd: args.cwd,
        projectIndex: args.projectIndex,
        limit: args.limit,
        pageSize: args.pageSize,
      },
    });
    return textContent(result.text || formatJson(result.data));
  }
  if (name === "lark_list_project_sessions") {
    const queryParams = new URLSearchParams();
    if (args.limit) queryParams.set("limit", String(Number(args.limit)));
    if (args.cwd) queryParams.set("cwd", args.cwd);
    const query = queryParams.toString() ? `?${queryParams}` : "";
    const result = await bridgeFetch(state, `/bridge/takeover/targets${query}`);
    return textContent(result.text || formatJson(result.data));
  }
  if (name === "lark_select_target") {
    const result = await bridgeFetch(state, "/bridge/takeover/select", {
      method: "POST",
      body: {
        selector: args.selector,
        threadId: args.threadId,
        optionIndex: args.optionIndex,
      },
    });
    return textContent(result.text || formatJson(result.data));
  }
  if (name === "lark_confirm_takeover") {
    const result = await bridgeFetch(state, "/bridge/takeover/execute", {
      method: "POST",
      body: {
        selector: args.selector,
        threadId: args.threadId,
        optionIndex: args.optionIndex,
      },
    });
    return textContent(result.text || formatJson(result.data));
  }
  if (name === "lark_clear_active_target") {
    const result = await bridgeFetch(state, "/bridge/takeover", { method: "DELETE" });
    return textContent(result.text || formatJson(result.data));
  }
  if (name === "lark_list_observation_targets") {
    const queryParams = new URLSearchParams();
    if (args.limit) queryParams.set("limit", String(Number(args.limit)));
    if (args.cwd) queryParams.set("cwd", args.cwd);
    const query = queryParams.toString() ? `?${queryParams}` : "";
    const result = await bridgeFetch(state, `/bridge/observation/targets${query}`);
    return textContent(result.text || formatJson(result.data));
  }
  if (name === "lark_start_observation") {
    const result = await bridgeFetch(state, "/bridge/observation/start", {
      method: "POST",
      body: {
        selector: args.selector,
        threadId: args.threadId,
        cwd: args.cwd,
        commandId: args.remoteCommandId || args.commandId,
        messageId: args.messageId,
        language: args.language,
        activatedBy: "mcp",
      },
    });
    return textContent(result.text || formatJson(result.data));
  }
  if (name === "lark_stop_observation") {
    const result = await bridgeFetch(state, "/bridge/observation", { method: "DELETE" });
    return textContent(result.text || formatJson(result.data));
  }
  if (name === "lark_unlock_control_window") {
    return textContent(formatJson(await bridgeFetch(state, "/bridge/handoff", { method: "DELETE" })));
  }
  if (name === "lark_get_remote_command") {
    return textContent(formatJson(await bridgeFetch(state, `/bridge/tasks/${encodeURIComponent(args.id)}`)));
  }
  if (name === "lark_cancel_remote_command") {
    return textContent(
      formatJson(
        await bridgeFetch(state, `/bridge/tasks/${encodeURIComponent(args.id)}/cancel`, {
          method: "POST",
        }),
      ),
    );
  }
  if (name === "lark_prepare_dispatch") {
    return textContent(formatJson(await bridgeFetch(state, "/bridge/dispatch/prepare", {
      method: "POST",
      body: { remoteCommandId: args.remoteCommandId },
    })));
  }
  if (name === "lark_route_remote_command") {
    return textContent(formatJson(await bridgeFetch(state, "/bridge/remote-command/route", {
      method: "POST",
      body: { remoteCommandId: args.remoteCommandId },
    })));
  }
  if (name === "lark_record_dispatch") {
    return textContent(formatJson(await bridgeFetch(state, "/bridge/dispatch/record", {
      method: "POST",
      body: {
        remoteCommandId: args.remoteCommandId,
        status: args.status,
        targetThreadId: args.targetThreadId,
        targetTitle: args.targetTitle,
        hostTool: args.hostTool,
        readbackOk: args.readbackOk,
        evidence: args.evidence,
        error: args.error,
      },
    })));
  }
  if (name === "lark_request_clarification") {
    return textContent(formatJson(await bridgeFetch(state, "/bridge/dispatch/clarify", {
      method: "POST",
      body: {
        remoteCommandId: args.remoteCommandId,
        question: args.question,
      },
    })));
  }
  if (name === "lark_reply_remote_command") {
    return textContent(formatJson(await bridgeFetch(state, "/bridge/remote-command/reply", {
      method: "POST",
      body: {
        remoteCommandId: args.remoteCommandId,
        text: args.text,
        status: args.status,
      },
    })));
  }
  return {
    isError: true,
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
  };
}

async function ensureBridge(args) {
  const config = await loadConfig(args);
  if (!hasLarkAppCredentials(config)) {
    return {
      running: false,
      blocked: true,
      config,
      message: formatMissingLarkCredentials(config),
    };
  }

  const current = await bridgeStatus(args);
  if (current.running) return current;

  const spawned = await startBridgeProcess(args);
  if (!spawned.running) {
    return {
      ...spawned,
      message: spawned.message || "Bridge is not running",
    };
  }
  return spawned;
}

async function stopBridge(args) {
  return stopBridgeProcess(args);
}

function formatStatus(status) {
  if (status.data?.text) return status.data.text;
  return formatJson(sanitizeBridgeStatus(status));
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function formatBridgeStartFailure(result = {}, operation = "bridge startup") {
  const reason = result.message || "Bridge did not report a running state.";
  const logPath = result.config?.dataDir ? `${result.config.dataDir}/bridge.log` : "~/.codex-lark-remote/bridge.log";
  const retry = operation === "start"
    ? "Retry lark_start, or retry lark_lock_control_window after explicit consent."
    : operation === "handoff"
      ? "Retry lark_lock_control_window after fixing the reason above."
      : operation === "takeover preparation"
        ? "Retry lark_prepare_takeover after fixing the reason above."
        : "Start or attach Lark Remote after fixing the reason above.";

  return [
    "Lark Remote bridge could not start.",
    `Reason: ${reason}`,
    `Log: ${logPath}`,
    "",
    "No separate pre-start step is required: handoff and takeover preparation both start or reuse the bridge themselves.",
    retry,
  ].join("\n");
}

function response(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function textContent(text) {
  return { content: [{ type: "text", text }] };
}

function formatHandoffConsentRequired() {
  return [
    "Lark Remote handoff requires explicit consent.",
    "",
    "This stores local routing state for the current Codex thread in the local Lark Remote bridge. Existing chat history is not sent to Feishu/Lark. Future Feishu/Lark messages and Codex replies may pass through your configured bot while handoff is active.",
    "",
    "If you consent, reply in this Codex chat with:",
    "I approve Lark Remote local bridge handoff for this conversation.",
  ].join("\n");
}

function formatTakeoverConsentRequired() {
  return [
    "Lark Remote takeover preparation requires explicit consent.",
    "",
    "This starts or reuses the local Lark Remote bridge, attaches this Codex window as the control window, and stores local takeover routing state. It does not send existing chat history to Feishu/Lark, and it does not attach this Codex window as the takeover target. Allowed Feishu/Lark users will choose a project, then choose a window, and must confirm before takeover.",
    "",
    "If you consent, reply in this Codex chat with:",
    "I approve Lark Remote takeover preparation for this project.",
  ].join("\n");
}

function formatMissingThreadContext() {
  return [
    "Lark Remote cannot safely bind this window.",
    "",
    "The Codex host did not provide the current conversation thread id or exact session path to the plugin call. To avoid routing Feishu/Lark messages into another Codex window that happens to share the same workspace path, handoff was not started.",
    "",
    "Refresh or update Codex/plugin support for per-window MCP metadata, then start handoff from the exact Codex conversation you want Feishu/Lark to continue.",
  ].join("\n");
}
