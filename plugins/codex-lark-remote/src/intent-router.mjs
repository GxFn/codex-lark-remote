import { classifyChatText, normalizeText } from "./lark.mjs";
import { readHandoff } from "./handoff.mjs";
import { readTakeover } from "./takeover.mjs";
import { readIntentSession, resolveIntentSessionMode } from "./intent-state.mjs";
import { translateTextToIntent } from "./intent-translator.mjs";

export async function routeChatTextAction(ctx, event, initialAction) {
  const text = normalizeText(event.text || "");
  if (isConsoleModeText(text)) return { kind: "intent_console_enable" };
  if (isHandoffModeText(text)) return { kind: "intent_handoff_mode" };

  const hasDataDir = Boolean(ctx.config?.dataDir);
  const [handoff, takeover, session] = hasDataDir ? await Promise.all([
    readHandoff({ dataDir: ctx.config.dataDir }),
    readTakeover({ dataDir: ctx.config.dataDir }),
    readIntentSession({ dataDir: ctx.config.dataDir, event, config: ctx.config }),
  ]) : [null, null, null];
  const mode = hasDataDir
    ? await resolveIntentSessionMode({ dataDir: ctx.config.dataDir, event, config: ctx.config })
    : "handoff";

  if (mode === "console") {
    return routeConsoleText(ctx, event, initialAction, { handoff, takeover, session });
  }

  if (handoff?.active || takeover?.state === "pending" || session?.mode === "handoff") {
    return classifyHandoffDirectText(text, ctx.config);
  }

  return initialAction;
}

export function classifyHandoffDirectText(text, config = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return { kind: "empty" };
  if (isConsoleModeText(normalized)) return { kind: "intent_console_enable" };
  if (isHandoffModeText(normalized)) return { kind: "intent_handoff_mode" };

  if (/^\/codex\b/i.test(normalized)) return classifyChatText(normalized, config);
  if (/^(whoami|我是谁|我的id|我的 id)[。.!！]?$/.test(normalized.toLowerCase())) return { kind: "whoami" };
  if (/^(help|帮助|命令|命令列表)[。.!！]?$/.test(normalized.toLowerCase())) return { kind: "help" };
  if (/^(status|状态|查看状态|看下状态|现在状态|当前状态)[。.?？!！]?$/.test(normalized.toLowerCase())) return { kind: "status" };
  if (/^(commands|command)\s+(on|show|enable|enabled|true)$/i.test(normalized)) return { kind: "command_visibility", enabled: true };
  if (/^(commands|command)\s+(off|hide|disable|disabled|false)$/i.test(normalized)) return { kind: "command_visibility", enabled: false };
  if (/^(handoff\s+off|退出接管|断开接管|断开连接|关闭接管|停止接管)[。.!！]?$/.test(normalized.toLowerCase())) {
    return { kind: "handoff_disable" };
  }
  if (/^(observe\s+off|停止观察|关闭观察)[。.!！]?$/.test(normalized.toLowerCase())) return { kind: "observe_disable" };

  return {
    kind: "task",
    forced: false,
    repoKey: config.defaultRepo || Object.keys(config.repos || {})[0] || "current",
    taskText: normalized,
  };
}

async function routeConsoleText(ctx, event, initialAction, state = {}) {
  const forwarded = parseForwardToHandoff(event.text);
  if (forwarded) return { kind: "task", forced: false, repoKey: "current", taskText: forwarded };

  const localAction = parseConsoleRuleAction(event.text, state);
  if (localAction) return localAction;

  const ruleIntent = actionToIntent(initialAction);
  const intent = ruleIntent || await translateTextToIntent({
    text: event.text,
    context: buildIntentContext({ ...state, event }),
    config: ctx.config,
    translator: ctx.intentTranslator,
  });
  return intentToAction(intent);
}

function actionToIntent(action = {}) {
  switch (action.kind) {
    case "help":
      return intent("system.help", {}, 1, false, "local command");
    case "whoami":
      return intent("identity.whoami", {}, 1, false, "local command");
    case "status":
      return intent("system.status", {}, 1, false, "local command");
    case "handoff_status":
      return intent("handoff.status", {}, 1, false, "local command");
    case "handoff_disable":
      return intent("handoff.disable", {}, 1, true, "local command");
    case "command_visibility":
      return intent(action.enabled === false ? "commands.hide" : "commands.show", {}, 1, false, "local command");
    case "takeover_list":
      return intent("takeover.list_projects", {}, 1, false, "local command");
    case "takeover_project_select":
      return intent("takeover.select_project", { selector: action.selector || action.projectIndex || action.cwd || "" }, 1, false, "local command");
    case "takeover_window_list":
      return intent("takeover.list_windows", {}, 1, false, "local command");
    case "takeover_select":
      return intent("takeover.select_window", { selector: action.selector || action.optionIndex || action.threadId || "" }, 1, false, "local command");
    case "takeover_execute":
      return intent("takeover.execute", { selector: action.selector || action.optionIndex || action.threadId || "" }, 1, true, "local command");
    case "takeover_disable":
      return intent("takeover.cancel", {}, 1, false, "local command");
    case "observe_list":
      return intent("observation.status", {}, 1, false, "local command");
    case "observe_enable":
      return intent("takeover.observe_window", { selector: action.selector || "" }, 1, false, "local command");
    case "observe_disable":
      return intent("observation.stop", {}, 1, false, "local command");
    default:
      return null;
  }
}

export function intentToAction(intentValue = {}) {
  const args = intentValue.args || {};
  const selector = String(args.selector ?? args.optionIndex ?? args.threadId ?? args.projectIndex ?? "").trim();
  switch (intentValue.intent) {
    case "system.help":
      return { kind: "help" };
    case "system.status":
      return { kind: "status" };
    case "identity.whoami":
      return { kind: "whoami" };
    case "commands.show":
      return { kind: "command_visibility", enabled: true };
    case "commands.hide":
      return { kind: "command_visibility", enabled: false };
    case "handoff.status":
      return { kind: "handoff_status" };
    case "handoff.disable":
      return { kind: "handoff_disable" };
    case "chat.forward_to_handoff":
      return { kind: "task", forced: false, repoKey: "current", taskText: String(args.message || "").trim() };
    case "takeover.list_projects":
      return { kind: "takeover_list" };
    case "takeover.select_project":
      return { kind: "takeover_project_select", selector };
    case "takeover.list_windows":
      return selector ? { kind: "takeover_project_select", selector } : { kind: "takeover_window_list" };
    case "takeover.select_window":
      return { kind: "takeover_select", selector };
    case "takeover.observe_window":
      return { kind: "takeover_observe", selector };
    case "takeover.execute":
      return { kind: "takeover_confirm", selector };
    case "takeover.cancel":
      return { kind: "takeover_disable" };
    case "takeover.status":
      return { kind: "takeover_status" };
    case "observation.status":
      return { kind: "observe_list" };
    case "observation.start":
      return { kind: "observe_enable", selector };
    case "observation.stop":
      return { kind: "observe_disable" };
    case "task.status":
      return { kind: "task_status", id: String(args.id || "") };
    case "task.cancel":
      return { kind: "cancel", id: String(args.id || "") };
    case "task.approve":
      return { kind: "approve", id: String(args.id || ""), action: String(args.action || "review") };
    case "clarify":
    case "unknown":
    default:
      return { kind: "intent_clarify", reason: publicClarifyReason(intentValue.reason) };
  }
}

function parseConsoleRuleAction(text, state = {}) {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return null;

  const projectSelector = matchConsoleProjectSelector(normalized);
  if (projectSelector) return { kind: "takeover_project_select", selector: projectSelector };

  const observeSelector = matchConsoleObserveSelector(normalized);
  if (observeSelector) return { kind: "takeover_observe", selector: observeSelector };

  const takeoverSelector = matchConsoleTakeoverSelector(normalized);
  if (takeoverSelector !== null) {
    return takeoverSelector ? { kind: "takeover_confirm", selector: takeoverSelector } : { kind: "takeover_confirm" };
  }

  const windowSelector = matchConsoleWindowSelector(normalized);
  if (windowSelector) return { kind: "takeover_select", selector: windowSelector };

  if (isProjectListText(normalized)) return { kind: "takeover_list" };
  if (isWindowListText(normalized)) return { kind: "takeover_window_list" };
  if (/^(?:列表|查看列表|看看列表|看一下列表|有哪些|看看有哪些|列一下|列出来)[。.?？!！]?$/.test(normalized)) {
    return state.takeover?.project || ["selecting", "selected", "pending", "active"].includes(state.takeover?.state)
      ? { kind: "takeover_window_list" }
      : { kind: "takeover_list" };
  }
  return null;
}

function isProjectListText(text) {
  if (/(窗口|会话|session|chat|观察)/i.test(text)) return false;
  if (/(项目|project|可接管|接管对象|能接管)/i.test(text) && /(列表|哪些|有什么|有啥|看看|查看|看一下|列出|列一下|显示|展示)/i.test(text)) {
    return true;
  }
  return /^(?:项目列表|查看项目|看看项目|看看有哪些项目|看一下有哪些项目|有哪些项目|列出项目|列一下项目|可接管项目|显示项目|projects|project list)[。.?？!！]?$/.test(text);
}

function isWindowListText(text) {
  if (/(窗口|会话|session|chat)/i.test(text) && /(列表|哪些|有什么|有啥|看看|查看|看一下|列出|列一下|显示|展示|可接管)/i.test(text)) {
    return true;
  }
  return /^(?:窗口列表|查看窗口|看看窗口|看看有哪些窗口|看一下有哪些窗口|有哪些窗口|列出窗口|列一下窗口|可接管窗口|windows|window list)[。.?？!！]?$/.test(text);
}

function matchConsoleProjectSelector(text) {
  return matchNumber(text, /^(?:进入|打开|开启|选择|选|查看|看|看看)?(?:第\s*)?([0-9一二两三四五六七八九十]+)\s*(?:个)?(?:项目|project)(?:详情)?吧?[。.!！]?$/);
}

function matchConsoleWindowSelector(text) {
  return matchNumber(text, /^(?:查看|看|看看|选择|选|打开)?(?:第\s*)?([0-9一二两三四五六七八九十]+)\s*(?:个)?(?:窗口|会话|session|chat)(?:详情)?吧?[。.!！]?$/);
}

function matchConsoleObserveSelector(text) {
  if (!/(观察|串流|进度|跟踪|盯|observe|watch)/i.test(text)) return "";
  return matchNumber(text, /^(?:开始|打开|开启|启用|切到|看|看看|观察|串流|跟踪|盯一下)?(?:第\s*)?([0-9一二两三四五六七八九十]+)\s*(?:个)?(?:窗口|会话|session|chat)?(?:的)?(?:观察|串流|进度)?吧?[。.!！]?$/);
}

function matchConsoleTakeoverSelector(text) {
  const match = text.match(/^(?:接管|确认接管|执行接管|现在接管|立即接管)(?:第\s*)?([0-9一二两三四五六七八九十]+)?\s*(?:个)?(?:窗口|会话|session|chat)?吧?[。.!！]?$/);
  if (!match) return null;
  return match[1] ? chineseNumberToAscii(match[1]) : "";
}

function matchNumber(text, pattern) {
  const match = text.match(pattern);
  return match?.[1] ? chineseNumberToAscii(match[1]) : "";
}

function chineseNumberToAscii(value) {
  const text = String(value || "").trim();
  if (/^\d+$/.test(text)) return text;
  const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text === "十") return "10";
  if (text.startsWith("十")) return String(10 + (map[text.slice(1)] || 0));
  if (text.includes("十")) {
    const [tens, ones] = text.split("十");
    return String((map[tens] || 1) * 10 + (map[ones] || 0));
  }
  return map[text] ? String(map[text]) : text;
}

function publicClarifyReason(reason) {
  const text = String(reason || "").trim();
  if (!text) return "我还不确定你想执行哪个操作。";
  if (/(codex translator failed|reading additional input from stdin|spawn |enoent|timed out|exit code|eacces)/i.test(text)) {
    return "我还没识别出这条控制指令。";
  }
  if (/^rules did not match$/i.test(text)) return "我还没识别出这条控制指令。";
  return text;
}

function buildIntentContext({ handoff, takeover, event }) {
  return {
    mode: "console",
    cwd: takeover?.scope?.cwd || handoff?.cwd || "",
    activeHandoff: handoff?.active ? {
      hasActive: true,
      threadPrefix: String(handoff.threadId || "").slice(0, 8),
      title: handoff.name || "",
      cwd: handoff.cwd || "",
    } : { hasActive: false },
    takeover: takeover ? {
      state: takeover.state || "",
      project: takeover.project ? {
        index: takeover.project.index || 0,
        name: takeover.project.name || "",
        cwd: takeover.project.cwd || "",
      } : null,
      projects: (takeover.projectSelection?.options || []).map((project) => ({
        index: project.index,
        name: project.name,
        cwd: project.cwd,
        windowCount: project.windowCount,
      })),
      windows: (takeover.selection?.options || []).map((window) => ({
        index: window.index,
        status: window.status,
        threadPrefix: String(window.threadId || "").slice(0, 8),
        title: window.name || "",
      })),
      selectedWindow: takeover.target ? {
        status: takeover.target.status || "",
        threadPrefix: String(takeover.target.threadId || "").slice(0, 8),
        title: takeover.target.name || "",
      } : null,
    } : null,
    user: {
      userIdHash: event?.userIdHash || "",
      chatIdHash: event?.chatIdHash || "",
    },
  };
}

function intent(intentName, args = {}, confidence = 1, needsConfirmation = false, reason = "") {
  return {
    schemaVersion: 1,
    intent: intentName,
    args,
    confidence,
    needsConfirmation,
    reason,
  };
}

function parseForwardToHandoff(text) {
  const match = normalizeText(text).match(/^(?:发送给当前线程|转发给当前线程|发给当前线程|发送给任务|转发给任务)[:：]\s*(.+)$/);
  return match?.[1]?.trim() || "";
}

function isConsoleModeText(text) {
  return /^(控制台|控制台模式|打开控制台|开启控制台|跳出接管|返回控制台|回到控制台|console|console mode)[。.!！]?$/.test(normalizeText(text).toLowerCase());
}

function isHandoffModeText(text) {
  return /^(继续接管|回到任务|回到接管|任务模式|接管模式|handoff mode)[。.!！]?$/.test(normalizeText(text).toLowerCase());
}
