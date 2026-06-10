import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildCodexExecArgs,
  buildCodexResumeArgs,
  buildHandoffPrompt,
  CodexCliRunner,
  createSessionProgressWatcher,
  extractFinalMessage,
  extractProgressSummary,
  formatPermissionBoundaryNotice,
  readSessionLastTurnSummary,
  summarizeCodexEvent,
  summarizeSessionProgressEvent,
  summarizeSessionUserPromptEvent,
} from "../plugins/codex-lark-remote/src/runner.mjs";
import { activateHandoff } from "../plugins/codex-lark-remote/src/handoff.mjs";
import { RemoteCommandQueue } from "../plugins/codex-lark-remote/src/queue.mjs";

test("buildCodexExecArgs uses supported codex exec flags", () => {
  const args = buildCodexExecArgs({
    runner: { sandbox: "workspace-write", askForApproval: "never", model: "gpt-test" },
    worktreePath: "/tmp/worktree",
    prompt: "fix tests",
  });

  assert.deepEqual(args, [
    "exec",
    "--json",
    "--ignore-user-config",
    "--sandbox",
    "workspace-write",
    "-C",
    "/tmp/worktree",
    "-m",
    "gpt-test",
    "fix tests",
  ]);
  assert.equal(args.includes("--ask-for-approval"), false);
});

test("buildCodexExecArgs can load user config when explicitly requested", () => {
  const args = buildCodexExecArgs({
    runner: { ignoreUserConfig: false },
    worktreePath: "/tmp/worktree",
    prompt: "fix tests",
  });

  assert.equal(args.includes("--ignore-user-config"), false);
});

test("buildCodexResumeArgs resumes a Codex thread in the handoff workspace", () => {
  const args = buildCodexResumeArgs({
    runner: { ignoreUserConfig: true, model: "gpt-test", sandbox: "workspace-write" },
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    prompt: "continue from lark",
    outputFile: "/tmp/final.txt",
    cwd: "/workspace",
  });

  assert.deepEqual(args, [
    "exec",
    "--ignore-user-config",
    "--sandbox",
    "workspace-write",
    "-C",
    "/workspace",
    "resume",
    "--json",
    "--skip-git-repo-check",
    "-m",
    "gpt-test",
    "-o",
    "/tmp/final.txt",
    "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    "continue from lark",
  ]);
});

test("buildCodexResumeArgs can keep the git repo check when explicitly requested", () => {
  const args = buildCodexResumeArgs({
    runner: { skipGitRepoCheck: false },
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    prompt: "continue from lark",
  });

  assert.equal(args.includes("--skip-git-repo-check"), false);
});

test("buildCodexResumeArgs does not inject Lark Remote MCP config for control windows", () => {
  const args = buildCodexResumeArgs({
    runner: { ignoreUserConfig: false },
    threadId: "control-thread",
    prompt: "route lark remote command",
    cwd: "/workspace",
    controlWindowCommand: true,
  });

  assert.equal(args.includes("--ignore-user-config"), false);
  assert.equal(args.includes("resume"), true);
  assert.doesNotMatch(args.join("\n"), /mcp_servers\.lark-remote/);
  assert.doesNotMatch(args.join("\n"), /codex-lark-remote-mcp-wrapper/);
});

test("buildHandoffPrompt wraps Feishu input as a control-window message by default", () => {
  const prompt = buildHandoffPrompt({
    id: "rcmd_note",
    userName: "ou_user",
    userIdHash: "u_hash",
    prompt: "fix README",
  });

  assert.match(prompt, /\[Lark Remote control message\]/);
  assert.match(prompt, /Use the lark-remote-control-window skill/);
  assert.match(prompt, /First call lark_route_remote_command/);
  assert.match(prompt, /follow its returned action and nextTool exactly/);
  assert.match(prompt, /remoteCommandId: rcmd_note/);
  assert.match(prompt, /activeTarget:\n- none/);
  assert.match(prompt, /<feishu_lark_message>\nfix README\n<\/feishu_lark_message>/);
  assert.doesNotMatch(prompt, /Control-window routing contract/);
  assert.doesNotMatch(prompt, /Permission boundary/);
  assert.doesNotMatch(prompt, /Sender:/);
  assert.doesNotMatch(prompt, /<target_prompt>/);
  assert.ok(prompt.split("\n").length <= 15);
});

test("buildHandoffPrompt keeps using the control envelope for subsequent turns", () => {
  const prompt = buildHandoffPrompt({
    userName: "ou_user",
    userIdHash: "u_hash",
    prompt: "fix README",
  });

  assert.match(prompt, /\[Lark Remote control message\]/);
  assert.match(prompt, /<feishu_lark_message>\nfix README\n<\/feishu_lark_message>/);
});

test("buildHandoffPrompt can still annotate Feishu input when configured", () => {
  const prompt = buildHandoffPrompt({
    userName: "ou_user",
    userIdHash: "u_hash",
    prompt: "fix README",
  }, { promptStyle: "annotated" });

  assert.match(prompt, /Lark Remote control message/);
  assert.match(prompt, /Compatibility note:/);
  assert.match(prompt, /fix README/);
  assert.doesNotMatch(prompt, /Permission boundary:/);
});

test("buildHandoffPrompt wraps target dispatch for the control window", () => {
  const prompt = buildHandoffPrompt({
    id: "rcmd_dispatch",
    userName: "ou_user",
    userIdHash: "u_hash",
    prompt: "优先处理这个变更",
    dispatchTarget: {
      threadId: "target-thread-1",
      name: "修复 lark 远程派发",
      cwd: "/workspace",
      status: "running",
      statusReason: "last event running",
    },
  });

  assert.match(prompt, /\[Lark Remote control message\]/);
  assert.match(prompt, /First call lark_route_remote_command/);
  assert.match(prompt, /Do not choose tools by guessing/);
  assert.doesNotMatch(prompt, /\[Lark Remote dispatch\]/);
  assert.match(prompt, /remoteCommandId: rcmd_dispatch/);
  assert.match(prompt, /- title: 修复 lark 远程派发/);
  assert.match(prompt, /- threadId: target-thread-1/);
  assert.match(prompt, /- status: running \(last event running\)/);
  assert.match(prompt, /- cwd: \/workspace/);
  assert.match(prompt, /<feishu_lark_message>\n优先处理这个变更\n<\/feishu_lark_message>/);
  assert.doesNotMatch(prompt, /target_prompt:/);
  assert.doesNotMatch(prompt, /<target_prompt>/);
  assert.doesNotMatch(prompt, /Control-window routing contract/);
  assert.doesNotMatch(prompt, /Permission boundary/);
  assert.doesNotMatch(prompt, /Selected target session/);
  assert.ok(prompt.split("\n").length <= 18);
});

test("CodexCliRunner sends a handoff started acknowledgement by default", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-runner-started-"));
  const fakeCodex = path.join(dataDir, "fake-codex");
  await fs.writeFile(fakeCodex, "#!/bin/sh\necho '{\"type\":\"turn.completed\"}'\nexit 0\n");
  await fs.chmod(fakeCodex, 0o755);
  await activateHandoff({ dataDir, threadId: "thread-1", cwd: dataDir });

  let command = {
    id: "rcmd_started",
    mode: "thread_handoff",
    status: "pending",
    messageId: "om_1",
    projectRoot: dataDir,
    prompt: "continue",
    codexSessionId: "thread-1",
  };
  const replies = [];
  const queue = {
    claimNext: async () => {
      if (command.status !== "pending") return null;
      command = { ...command, status: "running" };
      return command;
    },
    update: async (_id, patch) => {
      command = { ...command, ...patch };
      return command;
    },
    get: async () => command,
  };
  const runner = new CodexCliRunner({
    queue,
    config: {
      dataDir,
      runner: { codexPath: fakeCodex },
      handoff: { notifyProgress: false },
    },
    notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
  });

  await runner.processAll();

  assert.deepEqual(replies.find((reply) => reply.text === "已收到，Lark Remote 正在路由这条消息。"), {
    messageId: "om_1",
    text: "已收到，Lark Remote 正在路由这条消息。",
  });
});

test("CodexCliRunner localizes the handoff started acknowledgement in English", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-runner-started-en-"));
  const fakeCodex = path.join(dataDir, "fake-codex");
  await fs.writeFile(fakeCodex, "#!/bin/sh\necho '{\"type\":\"turn.completed\"}'\nexit 0\n");
  await fs.chmod(fakeCodex, 0o755);
  await activateHandoff({ dataDir, threadId: "thread-1", cwd: dataDir });

  let command = {
    id: "rcmd_started_en",
    mode: "thread_handoff",
    status: "pending",
    messageId: "om_1",
    projectRoot: dataDir,
    prompt: "continue",
    codexSessionId: "thread-1",
  };
  const replies = [];
  const queue = {
    claimNext: async () => {
      if (command.status !== "pending") return null;
      command = { ...command, status: "running" };
      return command;
    },
    update: async (_id, patch) => {
      command = { ...command, ...patch };
      return command;
    },
    get: async () => command,
  };
  const runner = new CodexCliRunner({
    queue,
    config: {
      dataDir,
      intent: { language: "en" },
      runner: { codexPath: fakeCodex },
      handoff: { notifyProgress: false },
    },
    notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
  });

  await runner.processAll();

  assert.deepEqual(replies.find((reply) => reply.text === "Received. Lark Remote is routing this message."), {
    messageId: "om_1",
    text: "Received. Lark Remote is routing this message.",
  });
});

test("CodexCliRunner suppresses the handoff started acknowledgement when explicitly disabled", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-runner-started-off-"));
  const fakeCodex = path.join(dataDir, "fake-codex");
  await fs.writeFile(fakeCodex, "#!/bin/sh\necho '{\"type\":\"turn.completed\"}'\nexit 0\n");
  await fs.chmod(fakeCodex, 0o755);
  await activateHandoff({ dataDir, threadId: "thread-1", cwd: dataDir });

  let command = {
    id: "rcmd_started_off",
    mode: "thread_handoff",
    status: "pending",
    messageId: "om_1",
    projectRoot: dataDir,
    prompt: "continue",
    codexSessionId: "thread-1",
  };
  const replies = [];
  const queue = {
    claimNext: async () => {
      if (command.status !== "pending") return null;
      command = { ...command, status: "running" };
      return command;
    },
    update: async (_id, patch) => {
      command = { ...command, ...patch };
      return command;
    },
    get: async () => command,
  };
  const runner = new CodexCliRunner({
    queue,
    config: {
      dataDir,
      runner: { codexPath: fakeCodex },
      handoff: { notifyProgress: false, notifyStarted: false },
    },
    notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
  });

  await runner.processAll();

  assert.equal(replies.some((reply) => reply.text === "已收到，Lark Remote 正在路由这条消息。"), false);
  assert.equal(replies.some((reply) => reply.text === "Received. Lark Remote is routing this message."), false);
});

test("CodexCliRunner suppresses handoff notifications after handoff is off", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-runner-off-"));
  const fakeCodex = path.join(dataDir, "fake-codex");
  await fs.writeFile(fakeCodex, "#!/bin/sh\necho '{\"type\":\"turn.completed\"}'\nexit 0\n");
  await fs.chmod(fakeCodex, 0o755);

  let command = {
    id: "rcmd_1",
    mode: "thread_handoff",
    status: "pending",
    notifyStarted: true,
    messageId: "om_1",
    projectRoot: dataDir,
    prompt: "continue",
    codexSessionId: "thread-1",
  };
  const replies = [];
  const queue = {
    claimNext: async () => {
      if (command.status !== "pending") return null;
      command = { ...command, status: "running" };
      return command;
    },
    update: async (_id, patch) => {
      command = { ...command, ...patch };
      return command;
    },
    get: async () => command,
  };
  const runner = new CodexCliRunner({
    queue,
    config: {
      dataDir,
      runner: { codexPath: fakeCodex },
      handoff: { notifyProgress: true },
    },
    notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
  });

  await runner.processAll();

  assert.equal(command.status, "completed");
  assert.deepEqual(replies, []);
});

test("CodexCliRunner accepts explicit control-window completion records", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-runner-control-record-"));

  let command = {
    id: "rcmd_control_recorded",
    mode: "thread_handoff",
    status: "pending",
    notifyStarted: false,
    controlWindowCommand: true,
    messageId: "om_1",
    projectRoot: dataDir,
    prompt: "项目列表",
    codexSessionId: "control-thread",
  };
  const replies = [];
  const queue = {
    claimNext: async () => {
      if (command.status !== "pending") return null;
      command = { ...command, status: "running" };
      return command;
    },
    update: async (_id, patch) => {
      command = { ...command, ...patch };
      return command;
    },
    get: async () => command,
  };
  const bridgeCalls = [];
  const runner = new CodexCliRunner({
    queue,
    config: {
      dataDir,
      runner: { codexPath: "codex" },
      handoff: { notifyProgress: true },
    },
    notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
    bridgeClient: {
      readState: async () => ({ url: "mock://bridge", token: "token" }),
      fetch: async (_state, route, options = {}) => {
        bridgeCalls.push({ route, body: options.body || null });
        if (route === "/bridge/remote-command/route") {
          return {
            success: true,
            data: {
              action: "control_reply",
              toolInput: {
                remoteCommandId: command.id,
                text: "当前可接管项目：CodexPlugin",
              },
            },
          };
        }
        if (route === "/bridge/remote-command/reply") {
          command = {
            ...command,
            status: "control_completed",
            controlStatus: "control_completed",
            result: options.body.text,
          };
          return { success: true, data: command, text: options.body.text };
        }
        throw new Error(`unexpected route ${route}`);
      },
    },
  });

  await runner.processAll();

  assert.equal(command.status, "control_completed", command.error);
  assert.equal(command.result, "当前可接管项目：CodexPlugin");
  assert.deepEqual(bridgeCalls.map((call) => call.route), [
    "/bridge/remote-command/route",
    "/bridge/remote-command/reply",
  ]);
  assert.deepEqual(replies, []);
});

test("CodexCliRunner executes control-window commands through the bridge client instead of codex exec", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-runner-user-config-"));
  const argsPath = path.join(dataDir, "args.json");
  const fakeCodex = path.join(dataDir, "fake-codex");
  await fs.writeFile(fakeCodex, [
    "#!/usr/bin/env node",
    "const fs = require('fs');",
    `fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));`,
    "console.log(JSON.stringify({ type: 'turn.completed' }));",
    "",
  ].join("\n"));
  await fs.chmod(fakeCodex, 0o755);

  let command = {
    id: "rcmd_control_config",
    mode: "thread_handoff",
    status: "pending",
    notifyStarted: false,
    controlWindowCommand: true,
    messageId: "om_1",
    projectRoot: dataDir,
    prompt: "项目列表",
    codexSessionId: "control-thread",
  };
  const queue = {
    claimNext: async () => {
      if (command.status !== "pending") return null;
      command = { ...command, status: "running" };
      return command;
    },
    update: async (_id, patch) => {
      command = { ...command, ...patch };
      return command;
    },
    get: async () => command,
  };
  const bridgeCalls = [];
  const runner = new CodexCliRunner({
    queue,
    config: {
      dataDir,
      runner: { codexPath: fakeCodex, ignoreUserConfig: true },
      handoff: { notifyProgress: false },
    },
    notifier: { reply: async () => {} },
    bridgeClient: {
      readState: async () => ({ url: "mock://bridge", token: "token" }),
      fetch: async (_state, route, options = {}) => {
        bridgeCalls.push({ route, body: options.body || null });
        if (route === "/bridge/remote-command/route") {
          return {
            success: true,
            data: {
              action: "control_reply",
              toolInput: {
                remoteCommandId: command.id,
                text: "当前可接管项目：CodexPlugin",
              },
            },
          };
        }
        if (route === "/bridge/remote-command/reply") {
          command = {
            ...command,
            status: "control_completed",
            controlStatus: "control_completed",
            result: options.body.text,
          };
          return { success: true, data: command, text: options.body.text };
        }
        throw new Error(`unexpected route ${route}`);
      },
    },
  });

  await runner.processAll();

  assert.equal(command.status, "control_completed", command.error);
  assert.deepEqual(bridgeCalls.map((call) => call.route), [
    "/bridge/remote-command/route",
    "/bridge/remote-command/reply",
  ]);
  await assert.rejects(fs.stat(argsPath), { code: "ENOENT" });
});

test("CodexCliRunner executes routed local control bridge tools", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-runner-local-control-"));
  let command = {
    id: "rcmd_commands_off",
    mode: "thread_handoff",
    status: "pending",
    notifyStarted: false,
    controlWindowCommand: true,
    messageId: "om_1",
    projectRoot: dataDir,
    prompt: "别刷命令了",
    codexSessionId: "control-thread",
  };
  const queue = {
    claimNext: async () => {
      if (command.status !== "pending") return null;
      command = { ...command, status: "running" };
      return command;
    },
    update: async (_id, patch) => {
      command = { ...command, ...patch };
      return command;
    },
    get: async () => command,
  };
  const bridgeCalls = [];
  const runner = new CodexCliRunner({
    queue,
    config: {
      dataDir,
      runner: { codexPath: "codex" },
      handoff: { notifyProgress: false },
    },
    notifier: { reply: async () => {} },
    bridgeClient: {
      readState: async () => ({ url: "mock://bridge", token: "token" }),
      fetch: async (_state, route, options = {}) => {
        bridgeCalls.push({ route, body: options.body || null });
        if (route === "/bridge/remote-command/route") {
          return {
            success: true,
            data: {
              action: "control",
              nextTool: "lark_set_command_visibility",
              toolInput: { enabled: false },
              completionToolInput: { remoteCommandId: command.id },
            },
          };
        }
        if (route === "/bridge/commands/visibility") {
          return { success: true, text: "Command display: off" };
        }
        if (route === "/bridge/remote-command/reply") {
          command = {
            ...command,
            status: "control_completed",
            controlStatus: "control_completed",
            result: options.body.text,
          };
          return { success: true, data: command, text: options.body.text };
        }
        throw new Error(`unexpected route ${route}`);
      },
    },
  });

  await runner.processAll();

  assert.equal(command.status, "control_completed", command.error);
  assert.equal(command.result, "Command display: off");
  assert.deepEqual(bridgeCalls.map((call) => call.route), [
    "/bridge/remote-command/route",
    "/bridge/commands/visibility",
    "/bridge/remote-command/reply",
  ]);
  assert.deepEqual(bridgeCalls[1].body, { enabled: false });
});

test("CodexCliRunner replies before stopping the bridge for routed stop", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-runner-stop-control-"));
  let command = {
    id: "rcmd_stop_bridge",
    mode: "thread_handoff",
    status: "pending",
    notifyStarted: false,
    controlWindowCommand: true,
    messageId: "om_1",
    projectRoot: dataDir,
    prompt: "确认关闭飞书连接",
    codexSessionId: "control-thread",
  };
  const queue = {
    claimNext: async () => {
      if (command.status !== "pending") return null;
      command = { ...command, status: "running" };
      return command;
    },
    update: async (_id, patch) => {
      command = { ...command, ...patch };
      return command;
    },
    get: async () => command,
  };
  const bridgeCalls = [];
  const runner = new CodexCliRunner({
    queue,
    config: {
      dataDir,
      runner: { codexPath: "codex" },
      handoff: { notifyProgress: false },
    },
    notifier: { reply: async () => {} },
    bridgeClient: {
      readState: async () => ({ url: "mock://bridge", token: "token" }),
      fetch: async (_state, route, options = {}) => {
        bridgeCalls.push({ route, body: options.body || null });
        if (route === "/bridge/remote-command/route") {
          return {
            success: true,
            data: {
              action: "control",
              nextTool: "lark_stop",
              toolInput: { remoteCommandId: command.id },
              completionToolInput: { remoteCommandId: command.id },
              summary: "正在关闭飞书连接。",
            },
          };
        }
        if (route === "/bridge/remote-command/reply") {
          command = {
            ...command,
            status: "control_completed",
            controlStatus: "control_completed",
            result: options.body.text,
          };
          return { success: true, data: command, text: options.body.text };
        }
        if (route === "/bridge/stop") {
          return { success: true, text: "Bridge stopping." };
        }
        throw new Error(`unexpected route ${route}`);
      },
    },
  });

  await runner.processAll();

  assert.equal(command.status, "control_completed", command.error);
  assert.equal(command.result, "正在关闭飞书连接。");
  assert.deepEqual(bridgeCalls.map((call) => call.route), [
    "/bridge/remote-command/route",
    "/bridge/remote-command/reply",
    "/bridge/stop",
  ]);
  assert.deepEqual(bridgeCalls[2].body, { remoteCommandId: "rcmd_stop_bridge" });
});

test("CodexCliRunner does not fall back to codex exec when local control routing is unavailable", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-runner-dispatch-record-"));
  const argsPath = path.join(dataDir, "args.jsonl");
  const fakeCodex = path.join(dataDir, "fake-codex");
  await fs.writeFile(fakeCodex, [
    "#!/usr/bin/env node",
    `require('node:fs').appendFileSync(${JSON.stringify(argsPath)}, process.argv.slice(2).join(' ') + '\\n');`,
    "console.log('{\"type\":\"turn.completed\"}');",
    "",
  ].join("\n"));
  await fs.chmod(fakeCodex, 0o755);
  await activateHandoff({
    dataDir,
    threadId: "control-thread",
    cwd: dataDir,
  });

  let command = {
    id: "rcmd_dispatch_missing_record",
    source: "lark",
    mode: "thread_handoff",
    status: "pending",
    notifyStarted: false,
    controlWindowCommand: true,
    handoffDispatch: true,
    messageId: "om_1",
    projectRoot: dataDir,
    prompt: "修复问题",
    codexSessionId: "control-thread",
    dispatchTarget: {
      threadId: "target-thread",
      name: "检查并修复 codex-lark-remote 功能",
    },
  };
  const replies = [];
  const queue = {
    claimNext: async () => {
      if (command.status !== "pending") return null;
      command = { ...command, status: "running" };
      return command;
    },
    update: async (_id, patch) => {
      command = { ...command, ...patch };
      return command;
    },
    get: async () => command,
  };
  const runner = new CodexCliRunner({
    queue,
    config: {
      dataDir,
      runner: { codexPath: fakeCodex },
      handoff: { notifyProgress: true },
    },
    notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
  });

  await runner.processAll();

  assert.equal(command.status, "failed");
  assert.match(command.error, /bridge 状态不可用/);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].messageId, "om_1");
  assert.match(replies[0].text, /bridge 状态不可用/);
  await assert.rejects(fs.stat(argsPath), { code: "ENOENT" });
});

test("CodexCliRunner still routes control-window commands while a target run is busy", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-runner-control-while-busy-"));
  const queue = new RemoteCommandQueue({ dataDir });
  await queue.enqueue({
    id: "rcmd_control_while_busy",
    source: "lark",
    mode: "thread_handoff",
    status: "pending",
    notifyStarted: false,
    controlWindowCommand: true,
    messageId: "om_1",
    projectRoot: dataDir,
    prompt: "项目列表",
    codexSessionId: "control-thread",
  });
  const bridgeCalls = [];
  const runner = new CodexCliRunner({
    queue,
    config: {
      dataDir,
      runner: { codexPath: "codex" },
      handoff: { notifyProgress: false },
    },
    notifier: { reply: async () => {} },
    bridgeClient: {
      readState: async () => ({ url: "mock://bridge", token: "token" }),
      fetch: async (_state, route, options = {}) => {
        bridgeCalls.push({ route, body: options.body || null });
        if (route === "/bridge/remote-command/route") {
          return {
            success: true,
            data: {
              action: "control_reply",
              toolInput: {
                remoteCommandId: "rcmd_control_while_busy",
                text: "当前可接管项目：CodexPlugin",
              },
            },
          };
        }
        if (route === "/bridge/remote-command/reply") {
          await queue.update(
            options.body.remoteCommandId,
            { status: "control_completed", controlStatus: "control_completed", result: options.body.text },
            "control_reply_recorded",
          );
          return { success: true, text: options.body.text };
        }
        throw new Error(`unexpected route ${route}`);
      },
    },
  });
  runner.busy = true;

  await runner.processAll();

  const command = await queue.get("rcmd_control_while_busy");
  assert.equal(command.status, "control_completed", command.error);
  assert.equal(command.result, "当前可接管项目：CodexPlugin");
  assert.deepEqual(bridgeCalls.map((call) => call.route), [
    "/bridge/remote-command/route",
    "/bridge/remote-command/reply",
  ]);
});

test("CodexCliRunner does not cancel local control commands when the control session is busy", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-runner-control-session-busy-"));
  const sessionPath = path.join(dataDir, "rollout-2026-05-13T10-01-00-control-thread.jsonl");
  await fs.writeFile(sessionPath, [
    JSON.stringify({ type: "session_meta", payload: { id: "control-thread", cwd: dataDir, name: "Control window" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "agent_reasoning", message: "control window is busy" } }),
    "",
  ].join("\n"));
  const queue = new RemoteCommandQueue({ dataDir });
  await queue.enqueue({
    id: "rcmd_control_session_busy",
    source: "lark",
    mode: "thread_handoff",
    status: "pending",
    notifyStarted: false,
    controlWindowCommand: true,
    messageId: "om_1",
    projectRoot: dataDir,
    prompt: "项目列表",
    codexSessionId: "control-thread",
    codexSessionPath: sessionPath,
  });
  const runner = new CodexCliRunner({
    queue,
    config: {
      dataDir,
      runner: { codexPath: "codex" },
      handoff: { notifyProgress: false, idleDebounceMs: 60_000 },
    },
    notifier: { reply: async () => {} },
    bridgeClient: {
      readState: async () => ({ url: "mock://bridge", token: "token" }),
      fetch: async (_state, route, options = {}) => {
        if (route === "/bridge/remote-command/route") {
          return {
            success: true,
            data: {
              action: "control_reply",
              toolInput: {
                remoteCommandId: "rcmd_control_session_busy",
                text: "当前可接管项目：CodexPlugin",
              },
            },
          };
        }
        if (route === "/bridge/remote-command/reply") {
          await queue.update(
            options.body.remoteCommandId,
            { status: "control_completed", controlStatus: "control_completed", result: options.body.text },
            "control_reply_recorded",
          );
          return { success: true, text: options.body.text };
        }
        throw new Error(`unexpected route ${route}`);
      },
    },
  });

  await runner.processAll();

  const command = await queue.get("rcmd_control_session_busy");
  assert.equal(command.status, "control_completed", command.error);
  assert.equal(command.result, "当前可接管项目：CodexPlugin");
});

test("CodexCliRunner fails closed when a routed local control tool fails", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-runner-control-fails-"));
  const queue = new RemoteCommandQueue({ dataDir });
  await queue.enqueue({
    id: "rcmd_control_failure",
    source: "lark",
    mode: "thread_handoff",
    status: "pending",
    notifyStarted: false,
    controlWindowCommand: true,
    messageId: "om_1",
    projectRoot: dataDir,
    prompt: "别刷命令了",
    codexSessionId: "control-thread",
  });
  const bridgeCalls = [];
  const runner = new CodexCliRunner({
    queue,
    config: {
      dataDir,
      runner: { codexPath: "codex" },
      handoff: { notifyProgress: false },
    },
    notifier: { reply: async () => {} },
    bridgeClient: {
      readState: async () => ({ url: "mock://bridge", token: "token" }),
      fetch: async (_state, route, options = {}) => {
        bridgeCalls.push({ route, body: options.body || null });
        if (route === "/bridge/remote-command/route") {
          return {
            success: true,
            data: {
              action: "control",
              nextTool: "lark_set_command_visibility",
              toolInput: { enabled: false },
              completionToolInput: { remoteCommandId: "rcmd_control_failure" },
            },
          };
        }
        if (route === "/bridge/commands/visibility") {
          return { success: false, error: "runtime config is not writable" };
        }
        throw new Error(`unexpected route ${route}`);
      },
    },
  });

  await runner.processAll();

  const command = await queue.get("rcmd_control_failure");
  assert.equal(command.status, "failed");
  assert.match(command.error, /lark_set_command_visibility failed: runtime config is not writable/);
  assert.deepEqual(bridgeCalls.map((call) => call.route), [
    "/bridge/remote-command/route",
    "/bridge/commands/visibility",
  ]);
});

test("CodexCliRunner fails closed when local dispatch execution fails", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-runner-dispatch-fails-"));
  const queue = new RemoteCommandQueue({ dataDir });
  await queue.enqueue({
    id: "rcmd_dispatch_failure",
    source: "lark",
    mode: "thread_handoff",
    status: "pending",
    notifyStarted: false,
    controlWindowCommand: true,
    handoffDispatch: true,
    messageId: "om_1",
    projectRoot: dataDir,
    prompt: "全面检查链路",
    codexSessionId: "control-thread",
    dispatchTarget: {
      threadId: "target-thread",
      name: "检查并修复 codex-lark-remote 功能",
      cwd: dataDir,
    },
  });
  const runner = new CodexCliRunner({
    queue,
    config: {
      dataDir,
      runner: { codexPath: "codex" },
      handoff: { notifyProgress: false },
    },
    notifier: { reply: async () => {} },
    bridgeClient: {
      readState: async () => ({ url: "mock://bridge", token: "token" }),
      fetch: async (_state, route, options = {}) => {
        if (route === "/bridge/remote-command/route") {
          return {
            success: true,
            data: {
              action: "dispatch",
              nextTool: "lark_dispatch_remote_command",
              toolInput: { remoteCommandId: options.body.remoteCommandId },
            },
          };
        }
        if (route === "/bridge/dispatch/execute") {
          return { success: false, error: "target queue write failed" };
        }
        throw new Error(`unexpected route ${route}`);
      },
    },
  });

  await runner.processAll();

  const command = await queue.get("rcmd_dispatch_failure");
  assert.equal(command.status, "failed");
  assert.match(command.error, /lark_dispatch_remote_command failed: target queue write failed/);
});

test("CodexCliRunner accepts a real routed control-window dispatch record", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-runner-control-dispatch-"));
  const argsPath = path.join(dataDir, "args.json");
  const deliveriesPath = path.join(dataDir, "host-deliveries.jsonl");
  const sessionPath = path.join(dataDir, "rollout-target-thread.jsonl");
  const fakeCodex = path.join(dataDir, "fake-codex");
  await fs.writeFile(sessionPath, "");
  await fs.writeFile(fakeCodex, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "async function main() {",
    "  const args = process.argv.slice(2);",
    `  fs.appendFileSync(${JSON.stringify(argsPath)}, JSON.stringify(args) + '\\n');`,
    "  const prompt = args.at(-1) || '';",
    "  if (prompt.startsWith('[Lark Remote dispatch]')) {",
    `    fs.appendFileSync(${JSON.stringify(deliveriesPath)}, JSON.stringify({ prompt }) + '\\n');`,
    `    fs.appendFileSync(${JSON.stringify(sessionPath)}, JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: '不应该通过 session watcher 发送到飞书。' } }) + '\\n');`,
    "    console.log(JSON.stringify({ type: 'response_item', payload: { type: 'message', phase: 'final_answer', message: '目标线程已收到并处理任务。' } }));",
    "    console.log(JSON.stringify({ type: 'turn.completed' }));",
    "    return;",
    "  }",
    "  throw new Error('control-window codex exec should not run for local dispatch');",
    "}",
    "main().catch((error) => {",
    "  console.error(error.stack || error.message);",
    "  process.exit(1);",
    "});",
    "",
  ].join("\n"));
  await fs.chmod(fakeCodex, 0o755);

  await activateHandoff({
    dataDir,
    threadId: "control-thread",
    cwd: dataDir,
  });

  const queue = new RemoteCommandQueue({ dataDir });
  const bridgeRequests = [];
  const bridgeClient = {
    readState: async () => ({ url: "mock://bridge", token: "token" }),
    fetch: async (_state, route, options = {}) => {
      const body = options.body || {};
      bridgeRequests.push({ route, body });
      if (route === "/bridge/remote-command/route") {
        return {
          success: true,
          data: {
            action: "dispatch",
            nextTool: "lark_dispatch_remote_command",
            completionTool: "lark_dispatch_remote_command",
            toolInput: { remoteCommandId: body.remoteCommandId },
          },
        };
      }
      if (route === "/bridge/dispatch/execute") {
        const original = await queue.get(body.remoteCommandId);
        const targetCommand = await queue.enqueue({
          source: "lark",
          mode: "thread_handoff",
          presentation: "chat",
          notifyQueued: false,
          notifyStarted: false,
          controlWindowCommand: false,
          targetWindowDispatch: true,
          handoffDispatch: true,
          parentRemoteCommandId: original.id,
          dispatchTarget: original.dispatchTarget,
          repoKey: "current",
          projectRoot: original.dispatchTarget.cwd,
          prompt: `[Lark Remote dispatch]\n${original.prompt}`,
          normalizedTask: original.normalizedTask,
          messageId: original.messageId,
          chatIdHash: original.chatIdHash,
          userIdHash: original.userIdHash,
          userName: original.userName,
          codexSessionId: original.dispatchTarget.threadId,
          codexSessionPath: sessionPath,
        });
        await queue.update(
          original.id,
          {
            status: "dispatch_sent",
            dispatchStatus: "dispatch_sent",
            dispatchTargetCommandId: targetCommand.id,
            dispatchTargetThreadId: original.dispatchTarget.threadId,
            dispatchTargetTitle: original.dispatchTarget.name,
            dispatchHostTool: "lark_dispatch_remote_command",
            dispatchReadbackOk: true,
            result: "已派发到：检查并修复 codex-lark-remote 功能",
            completedAt: new Date().toISOString(),
          },
          "dispatch_recorded",
        );
        return { success: true, data: { targetCommand } };
      }
      throw new Error(`unexpected route ${route}`);
    },
  };
  await queue.enqueue({
    id: "rcmd_control_dispatch_e2e",
    source: "lark",
    mode: "thread_handoff",
    notifyStarted: false,
    controlWindowCommand: true,
    handoffDispatch: true,
    messageId: "om_1",
    projectRoot: dataDir,
    prompt: "全面检查一下各个链路功能，优化代码逻辑，保证清晰的语义职责，检查修复 bug",
    codexSessionId: "control-thread",
    dispatchTarget: {
      threadId: "target-thread",
      name: "检查并修复 codex-lark-remote 功能",
      cwd: dataDir,
      status: "running",
    },
  });

  const replies = [];
  const runner = new CodexCliRunner({
    queue,
    config: {
      dataDir,
      runner: { codexPath: fakeCodex, ignoreUserConfig: true },
      handoff: { notifyProgress: true, notifyStarted: false },
    },
    notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
    bridgeClient,
  });

  await runner.processAll();

  const command = await queue.get("rcmd_control_dispatch_e2e");
  assert.equal(command.status, "dispatch_sent");
  assert.equal(command.dispatchStatus, "dispatch_sent");
  assert.equal(command.dispatchTargetThreadId, "target-thread");
  assert.equal(command.dispatchHostTool, "lark_dispatch_remote_command");
  assert.equal(command.dispatchReadbackOk, true);
  assert.match(command.result, /已派发到：检查并修复 codex-lark-remote 功能/);
  assert.deepEqual(replies, [
    {
      messageId: "om_1",
      text: "目标线程已收到并处理任务。",
    },
  ]);
  assert.equal(replies.some((reply) => /session watcher/.test(reply.text)), false);

  const argRuns = (await fs.readFile(argsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(argRuns.length, 1);
  assert.match(argRuns[0].at(-1), /^\[Lark Remote dispatch\]\n全面检查一下各个链路功能/);
  assert.doesNotMatch(argRuns[0].at(-1), /remoteCommandId/);
  assert.doesNotMatch(argRuns[0].at(-1), /lark_route_remote_command/);
  assert.deepEqual(bridgeRequests.map((item) => item.route), [
    "/bridge/remote-command/route",
    "/bridge/dispatch/execute",
  ]);
  assert.equal(bridgeRequests[0].body.remoteCommandId, "rcmd_control_dispatch_e2e");
  assert.equal(bridgeRequests[1].body.remoteCommandId, "rcmd_control_dispatch_e2e");

  const [delivery] = (await fs.readFile(deliveriesPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.match(delivery.prompt, /^\[Lark Remote dispatch\]\n全面检查一下各个链路功能/);
  assert.doesNotMatch(delivery.prompt, /remoteCommandId/);
  assert.doesNotMatch(delivery.prompt, /lark_route_remote_command/);

  const targetCommand = await queue.get(command.dispatchTargetCommandId);
  assert.equal(targetCommand.targetWindowDispatch, true);
  assert.equal(targetCommand.controlWindowCommand, false);
  assert.equal(targetCommand.codexSessionId, "target-thread");
  assert.equal(targetCommand.codexSessionPath, sessionPath);
});

test("CodexCliRunner recovers stale target dispatch commands and notifies Lark", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-runner-stale-target-"));
  const queue = new RemoteCommandQueue({ dataDir });
  await queue.enqueue({
    id: "rcmd_stale_target",
    source: "lark",
    mode: "thread_handoff",
    presentation: "chat",
    notifyStarted: false,
    messageId: "om_1",
    projectRoot: dataDir,
    prompt: "[Lark Remote dispatch]\n测试连通性",
    codexSessionId: "target-thread",
    targetWindowDispatch: true,
    handoffDispatch: true,
  });
  await queue.claimNext({ runnerPid: process.pid, runnerId: "old-runner" });
  await queue.update(
    "rcmd_stale_target",
    { runnerHeartbeatAt: "2026-06-10T00:00:00.000Z" },
    "test_heartbeat_backdated",
  );

  const replies = [];
  const runner = new CodexCliRunner({
    queue,
    config: {
      dataDir,
      runner: { codexPath: "codex", staleRunningMs: 60_000 },
      handoff: { notifyProgress: false, notifyStarted: false },
    },
    notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
  });

  await runner.processAll();

  const command = await queue.get("rcmd_stale_target");
  assert.equal(command.status, "failed");
  assert.match(command.error, /执行器中断/);
  assert.deepEqual(replies, [
    {
      messageId: "om_1",
      text: "派发未完成，消息已保留。\nLark Remote 执行器中断，命令未完成。",
    },
  ]);
});

test("CodexCliRunner suppresses user prompt echoes during handoff progress", async () => {
  async function runCase({ source, prompt }) {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), `codex-lark-runner-user-prompt-${source}-`));
    const sessionPath = path.join(dataDir, "rollout-thread-1.jsonl");
    const fakeCodex = path.join(dataDir, "fake-codex");
    await fs.writeFile(sessionPath, "");
    const stableTime = new Date(Date.now() - 10_000);
    await fs.utimes(sessionPath, stableTime, stableTime);
    await fs.writeFile(fakeCodex, [
      "#!/usr/bin/env node",
      "const fs = require('fs');",
      `const sessionPath = ${JSON.stringify(sessionPath)};`,
      `const prompt = ${JSON.stringify(prompt)};`,
      "fs.appendFileSync(sessionPath, JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: prompt } }) + '\\n');",
      "fs.appendFileSync(sessionPath, JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: '正在继续处理。' } }) + '\\n');",
      "console.log(JSON.stringify({ type: 'turn.completed' }));",
      "",
    ].join("\n"));
    await fs.chmod(fakeCodex, 0o755);
    await activateHandoff({ dataDir, threadId: "thread-1", threadPath: sessionPath, cwd: dataDir });

    let command = {
      id: `rcmd_${source}`,
      source,
      mode: "thread_handoff",
      status: "pending",
      notifyStarted: false,
      messageId: "om_1",
      projectRoot: dataDir,
      prompt,
      codexSessionId: "thread-1",
      codexSessionPath: sessionPath,
    };
    const replies = [];
    const queue = {
      claimNext: async () => {
        if (command.status !== "pending") return null;
        command = { ...command, status: "running" };
        return command;
      },
      update: async (_id, patch) => {
        command = { ...command, ...patch };
        return command;
      },
      get: async () => command,
    };
    const runner = new CodexCliRunner({
      queue,
      config: {
        dataDir,
        runner: { codexPath: fakeCodex },
        handoff: { notifyProgress: true, idleDebounceMs: 0 },
      },
      notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
    });

    await runner.processAll();
    return replies.map((reply) => reply.text);
  }

  const larkReplies = await runCase({ source: "lark", prompt: "飞书发起的接管输入" });
  assert.equal(larkReplies.some((text) => /用户提示：/.test(text)), false);
  assert.equal(larkReplies.some((text) => /正在继续处理。/.test(text)), true);

  const automationReplies = await runCase({ source: "automation", prompt: "自动化发起的新一轮输入" });
  assert.equal(automationReplies.some((text) => /用户提示：/.test(text)), false);
  assert.equal(automationReplies.some((text) => /正在继续处理。/.test(text)), true);
});

test("CodexCliRunner discards a handoff command if the desktop session became busy before resume", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-runner-desktop-busy-"));
  const marker = path.join(dataDir, "codex-invoked");
  const fakeCodex = path.join(dataDir, "fake-codex");
  await fs.writeFile(fakeCodex, `#!/bin/sh\necho invoked > ${JSON.stringify(marker)}\nexit 0\n`);
  await fs.chmod(fakeCodex, 0o755);
  const sessionPath = path.join(dataDir, "rollout-2026-05-13T10-01-00-thread-1.jsonl");
  await fs.writeFile(sessionPath, [
    JSON.stringify({ type: "session_meta", payload: { id: "thread-1", cwd: dataDir, name: "Busy desktop" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "agent_reasoning", message: "desktop is working" } }),
    "",
  ].join("\n"));
  await activateHandoff({ dataDir, threadId: "thread-1", threadPath: sessionPath, cwd: dataDir });

  let command = {
    id: "rcmd_busy",
    mode: "thread_handoff",
    status: "pending",
    notifyStarted: true,
    messageId: "om_1",
    projectRoot: dataDir,
    prompt: "continue from lark",
    codexSessionId: "thread-1",
    codexSessionPath: sessionPath,
  };
  const replies = [];
  const queue = {
    claimNext: async () => {
      if (command.status !== "pending") return null;
      command = { ...command, status: "running" };
      return command;
    },
    update: async (_id, patch) => {
      command = { ...command, ...patch };
      return command;
    },
    get: async () => command,
  };
  const runner = new CodexCliRunner({
    queue,
    config: {
      dataDir,
      runner: { codexPath: fakeCodex },
      handoff: { notifyProgress: false, idleDebounceMs: 60_000 },
    },
    notifier: { reply: async (messageId, text) => replies.push({ messageId, text }) },
  });

  await runner.processAll();

  assert.equal(command.status, "cancelled");
  assert.match(command.error, /正在 Codex Desktop 中执行/);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /没有发送，也不会排队/);
  await assert.rejects(fs.stat(marker), { code: "ENOENT" });
});

test("formatPermissionBoundaryNotice explains approval UI boundaries", () => {
  const text = formatPermissionBoundaryNotice("This action was rejected due to unacceptable risk.");

  assert.match(text, /Permission needed/);
  assert.match(text, /cannot click Codex Desktop permission dialogs/);
  assert.match(text, /Codex security review blocked the action/);

  const zh = formatPermissionBoundaryNotice("tool call rejected: requires approval in Codex Desktop", { language: "zh" });
  assert.match(zh, /需要权限确认/);
  assert.match(zh, /需要 Codex 权限批准/);
  assert.match(zh, /回到 Codex Desktop 批准/);
});

test("formatPermissionBoundaryNotice ignores source text that only discusses permissions", () => {
  assert.equal(
    formatPermissionBoundaryNotice("Alembic-legacy/templates/recipes-setup/seed-error-handling.md [1495 lines, 79897 chars]"),
    "",
  );
  assert.equal(
    formatPermissionBoundaryNotice("| ④ **\"Save this error handling pattern as a project convention\"** | One-time capture — every team member's AI learns this pattern | [260 lines, 14341 chars]"),
    "",
  );
  assert.equal(
    formatPermissionBoundaryNotice('import { execFileSync } from "node:child_process"; [260 lines, 9729 chars]'),
    "",
  );
  assert.equal(
    formatPermissionBoundaryNotice("A team member may request approval before saving a project convention."),
    "",
  );
});

test("extractFinalMessage reads Codex JSONL agent messages", () => {
  const stdout = [
    JSON.stringify({ type: "item.completed", item: { type: "command_execution", aggregated_output: "npm test" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Status: waiting_review\n\nSummary:\n- done" } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1 } }),
  ].join("\n");

  assert.equal(extractFinalMessage(stdout), "Status: waiting_review\n\nSummary:\n- done");
});

test("extractFinalMessage reads desktop session style final messages", () => {
  const stdout = [
    JSON.stringify({
      type: "response_item",
      payload: { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "working" }] },
    }),
    JSON.stringify({
      type: "event_msg",
      payload: { type: "agent_message", phase: "final_answer", message: "done from desktop style" },
    }),
  ].join("\n");

  assert.equal(extractFinalMessage(stdout), "done from desktop style");
});

test("summarizeCodexEvent reports useful background progress", () => {
  assert.equal(
    summarizeCodexEvent({ type: "item.completed", item: { type: "command_execution", command: "npm test", aggregated_output: "51 passed" } }),
    "",
  );
  assert.match(
    summarizeCodexEvent({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "npm install",
        aggregated_output: "Network access is restricted. Ask for approval before downloading dependencies.",
        exit_code: 1,
        status: "failed",
      },
    }),
    /Permission needed[\s\S]*Network or dependency access needs approval/,
  );
  assert.equal(
    summarizeCodexEvent({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "sed -n '1,220p' Alembic-legacy/templates/recipes-setup/seed-error-handling.md",
        aggregated_output: [
          "Alembic Guard skill requires an MCP tool when available.",
          "Feishu/Lark cannot click native Codex Desktop permission dialogs.",
          "A team member may request approval before saving a project convention.",
        ].join("\n"),
        exit_code: 0,
        status: "completed",
      },
    }),
    "",
  );
  assert.equal(
    summarizeCodexEvent({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "nl -ba Sources/AppAudio.swift",
        aggregated_output: [
          "1 Logger.app.error(\"AVAudioSession 设置失败: \\(error.localizedDescription)\")",
          "2 public enum NetworkStatus { case reachable, restricted }",
          "3 let dependencyDirection = FeatureDependencyDirection.outbound",
        ].join("\n"),
      },
    }),
    "",
  );
  assert.equal(
    summarizeCodexEvent(
      { type: "item.completed", item: { type: "command_execution", command: "npm test", aggregated_output: "51 passed" } },
      { showCommands: true },
    ),
    "Ran command:\nnpm test\nOutput:\n51 passed",
  );
  assert.match(
    summarizeCodexEvent(
      {
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "nl -ba file.swift",
          aggregated_output: "1 import Foundation\n2 let value = true",
        },
      },
      { showCommands: true },
    ),
    /Ran command:\nnl -ba file\.swift\nOutput:\n\[omitted source\/code output: 2 lines, \d+ chars\]/,
  );
  assert.match(
    summarizeCodexEvent(
      {
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "sed -n '1,260p' Sources/App.swift",
          aggregated_output: "import Foundation\nfunc run() {}\nlet value = true",
        },
      },
      { showCommands: true },
    ),
    /Ran command:\nsed -n '1,260p' Sources\/App\.swift\nOutput:\n\[omitted source\/code output: 3 lines, \d+ chars\]/,
  );
  assert.match(
    summarizeCodexEvent(
      {
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "npm test",
          aggregated_output: "TAP version 13\nok 1 - works\n1..1\n# pass 1",
        },
      },
      { showCommands: true },
    ),
    /Ran command:\nnpm test\nOutput:\nok 1 - works \[4 lines, \d+ chars\]/,
  );
  assert.match(
    summarizeCodexEvent(
      {
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "rg -n CookieProvider Sources",
          aggregated_output: "Sources/App.swift:12:let cookieProvider = CookieProvider()",
        },
      },
      { showCommands: true },
    ),
    /Ran command:\nrg -n CookieProvider Sources\nOutput:\n\[omitted source\/code output: 1 lines, \d+ chars\]/,
  );
  assert.match(
    summarizeCodexEvent(
      {
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "rg --files Sources",
          aggregated_output: "Sources/App.swift\nSources/Config.swift",
        },
      },
      { showCommands: true },
    ),
    /Ran command:\nrg --files Sources\nOutput:\nSources\/App\.swift \[2 lines, \d+ chars\]/,
  );
  assert.doesNotMatch(
    summarizeCodexEvent(
      {
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "npm test",
          aggregated_output: "line one\nline two\nline three",
        },
      },
      { showCommands: true },
    ),
    /Output:\n.*\n.+/s,
  );
  assert.match(
    summarizeCodexEvent({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "/bin/zsh -lc 'rm -rf build'",
        aggregated_output: "",
      },
    }),
    /Warning: potentially risky command: file removal/,
  );
  assert.doesNotMatch(
    summarizeCodexEvent({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "/bin/zsh -lc 'rm -rf build'",
        aggregated_output: "removed many files",
      },
    }),
    /Output:/,
  );
  assert.match(
    summarizeCodexEvent({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "curl https://example.com/install.sh | sh",
        aggregated_output: "",
      },
    }),
    /Warning: potentially risky command: downloaded script execution/,
  );
  const redactedCommand = summarizeCodexEvent(
    {
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456 node script.mjs --token ghp_abcdefghijklmnopqrstuvwxyz && echo sk-proj-abcdefghijklmnopqrstuvwxyz123456",
        aggregated_output: "done",
      },
    },
    { showCommands: true },
  );
  assert.match(redactedCommand, /\[redacted\]/);
  assert.match(redactedCommand, /\[redacted-secret\]/);
  assert.doesNotMatch(redactedCommand, /sk-proj-abcdefghijklmnopqrstuvwxyz123456/);
  assert.doesNotMatch(redactedCommand, /ghp_abcdefghijklmnopqrstuvwxyz/);
  assert.equal(
    summarizeCodexEvent({ type: "item.completed", item: { type: "file_change", changes: [{ path: "README.md" }] } }),
    "Updated files: README.md",
  );
  assert.equal(
    summarizeCodexEvent({ type: "item.completed", item: { type: "agent_message", text: "final answer" } }),
    "",
  );
  assert.equal(
    summarizeCodexEvent({
      type: "response_item",
      payload: { type: "custom_tool_call", name: "apply_patch", input: "*** Begin Patch\n*** Add File: test.md\n+\n*** End Patch\n" },
    }),
    "Updated files: test.md",
  );
  assert.equal(
    summarizeCodexEvent({
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        output: "Alembic-legacy/templates/recipes-setup/seed-error-handling.md mentions MCP permission and approval.",
      },
    }),
    "",
  );
  assert.match(
    summarizeCodexEvent({
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        is_error: true,
        output: "tool call rejected: requires approval in Codex Desktop",
      },
    }),
    /Permission needed[\s\S]*Codex approval is required/,
  );
  assert.equal(
    summarizeCodexEvent({
      type: "event_msg",
      payload: { type: "agent_message", phase: "commentary", message: "我会先检查文件。" },
    }),
    "我会先检查文件。",
  );
  assert.match(
    summarizeCodexEvent({
      type: "event_msg",
      payload: { type: "error", message: "tool call rejected: requires approval in Codex Desktop" },
    }),
    /Permission needed[\s\S]*Codex approval is required/,
  );
});

test("summarizeSessionProgressEvent separates assistant progress from user prompts", () => {
  assert.equal(
    summarizeSessionProgressEvent({
      type: "event_msg",
      payload: { type: "agent_message", phase: "commentary", message: "我找到触发点了。" },
    }),
    "我找到触发点了。",
  );
  assert.equal(
    summarizeSessionProgressEvent({
      type: "item.completed",
      item: { type: "command_execution", command: "npm test", aggregated_output: "ok" },
    }),
    "",
  );
  assert.equal(
    summarizeSessionProgressEvent({
      type: "event_msg",
      payload: { type: "agent_message", phase: "final_answer", message: "done" },
    }),
    "",
  );
  assert.equal(
    summarizeSessionProgressEvent({
      type: "event_msg",
      payload: { type: "agent_message", phase: "final_answer", message: "done" },
    }, { includeFinalAnswers: true }),
    "done",
  );
  assert.equal(
    summarizeSessionProgressEvent({
      type: "event_msg",
      payload: { type: "user_message", message: "请检查观察输出" },
    }),
    "",
  );
  assert.equal(
    summarizeSessionUserPromptEvent({
      type: "event_msg",
      payload: { type: "user_message", message: "请检查观察输出" },
    }),
    "用户提示：\n请检查观察输出",
  );
  assert.equal(
    summarizeSessionUserPromptEvent({
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "check observation output" }] },
    }, { language: "en" }),
    "User prompt:\ncheck observation output",
  );
});

test("createSessionProgressWatcher tails appended assistant commentary", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-session-progress-"));
  const sessionPath = path.join(dir, "rollout-test.jsonl");
  await fs.writeFile(
    sessionPath,
    `${JSON.stringify({ type: "event_msg", payload: { type: "agent_message", phase: "commentary", message: "old" } })}\n`,
  );
  const summaries = [];
  const watcher = createSessionProgressWatcher({
    sessionPath,
    intervalMs: 10,
    onEvent: async (_event, summary) => summaries.push(summary),
  });
  await watcher.start();
  await fs.appendFile(
    sessionPath,
    [
      JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "npm test", aggregated_output: "ok" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "agent_message", phase: "commentary", message: "我找到触发点了。" } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "我找到触发点了。" }] } }),
      JSON.stringify({ type: "event_msg", payload: { type: "agent_message", phase: "final_answer", message: "done" } }),
      "",
    ].join("\n"),
  );
  await watcher.stop();

  assert.deepEqual(summaries, ["我找到触发点了。"]);
});

test("createSessionProgressWatcher can include appended user prompts as turn separators", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-session-user-prompt-"));
  const sessionPath = path.join(dir, "rollout-test.jsonl");
  await fs.writeFile(sessionPath, "");
  const summaries = [];
  const watcher = createSessionProgressWatcher({
    sessionPath,
    intervalMs: 10,
    includeUserPrompts: true,
    eventOptions: { language: "en" },
    onEvent: async (_event, summary) => summaries.push(summary),
  });
  await watcher.start();
  await fs.appendFile(
    sessionPath,
    [
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "check observation output" }] } }),
      JSON.stringify({ type: "event_msg", payload: { type: "agent_message", phase: "commentary", message: "我找到触发点了。" } }),
      "",
    ].join("\n"),
  );
  await watcher.stop();

  assert.deepEqual(summaries, [
    "User prompt:\ncheck observation output",
    "我找到触发点了。",
  ]);
});

test("createSessionProgressWatcher can forward final answers when enabled", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-session-final-progress-"));
  const sessionPath = path.join(dir, "rollout-test.jsonl");
  await fs.writeFile(sessionPath, "");
  const summaries = [];
  const watcher = createSessionProgressWatcher({
    sessionPath,
    intervalMs: 10,
    eventOptions: { includeFinalAnswers: true },
    onEvent: async (_event, summary) => summaries.push(summary),
  });
  await watcher.start();
  await fs.appendFile(
    sessionPath,
    [
      JSON.stringify({ type: "event_msg", payload: { type: "agent_message", phase: "final_answer", message: "目标会话最终回复。" } }),
      "",
    ].join("\n"),
  );
  await watcher.stop();

  assert.deepEqual(summaries, ["目标会话最终回复。"]);
});

test("createSessionProgressWatcher can suppress or rewrite user prompt notifications", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-session-user-prompt-filter-"));
  const sessionPath = path.join(dir, "rollout-test.jsonl");
  await fs.writeFile(sessionPath, "");
  const summaries = [];
  const watcher = createSessionProgressWatcher({
    sessionPath,
    intervalMs: 10,
    includeUserPrompts: true,
    userPromptText: (_event, prompt) => prompt.includes("Lark Remote") ? "" : `external: ${prompt}`,
    onEvent: async (_event, summary) => summaries.push(summary),
  });
  await watcher.start();
  await fs.appendFile(
    sessionPath,
    [
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "[Lark Remote handoff]\n来自飞书" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "自动化继续执行" } }),
      "",
    ].join("\n"),
  );
  await watcher.stop();

  assert.deepEqual(summaries, ["用户提示：\nexternal: 自动化继续执行"]);
});

test("extractProgressSummary collects non-chat Codex JSONL events", () => {
  const stdout = [
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "npm test", aggregated_output: "ok" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "final answer" } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 20 } }),
  ].join("\n");

  assert.equal(
    extractProgressSummary(stdout),
    "",
  );
  assert.equal(
    extractProgressSummary(stdout, { showCommands: true }),
    [
      "Ran command:\nnpm test\nOutput:\nok",
    ].join("\n"),
  );
});

test("readSessionLastTurnSummary returns the last completed turn final reply", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-session-recap-"));
  const sessionPath = path.join(dataDir, "session.jsonl");
  const lines = [
    { type: "session_meta", payload: { id: "thread-1", cwd: dataDir } },
    { type: "turn.started", payload: {} },
    { type: "event_msg", payload: { type: "agent_message", phase: "final_answer", message: "旧任务已经结束。" } },
    { type: "turn.completed", payload: {} },
    { type: "turn.started", payload: {} },
    { type: "event_msg", payload: { type: "agent_message", message: "正在检查接管链路。" } },
    { type: "event_msg", payload: { type: "agent_message", phase: "final_answer", message: "新任务完成：已修复接管提示。" } },
    { type: "turn.completed", payload: {} },
  ].map((event) => JSON.stringify(event));
  await fs.writeFile(sessionPath, `${lines.join("\n")}\n`);

  const summary = await readSessionLastTurnSummary(sessionPath);

  assert.equal(summary.finalMessage, "新任务完成：已修复接管提示。");
  assert.match(summary.progressSummary, /正在检查接管链路/);
  assert.doesNotMatch(summary.finalMessage, /旧任务/);
});

test("readSessionLastTurnSummary recognizes Codex Desktop task boundaries", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-session-recap-desktop-"));
  const sessionPath = path.join(dataDir, "session.jsonl");
  const lines = [
    { type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } },
    { type: "event_msg", payload: { type: "agent_message", phase: "final_answer", message: "旧桌面任务完成。" } },
    { type: "event_msg", payload: { type: "task_complete", turn_id: "turn-1" } },
    { type: "event_msg", payload: { type: "task_started", turn_id: "turn-2" } },
    { type: "event_msg", payload: { type: "agent_message", message: "正在处理桌面任务。" } },
    { type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "text", text: "桌面任务完成：可以同步给飞书。" }] } },
    { type: "event_msg", payload: { type: "task_complete", turn_id: "turn-2" } },
  ].map((event) => JSON.stringify(event));
  await fs.writeFile(sessionPath, `${lines.join("\n")}\n`);

  const summary = await readSessionLastTurnSummary(sessionPath);

  assert.equal(summary.finalMessage, "桌面任务完成：可以同步给飞书。");
  assert.match(summary.progressSummary, /正在处理桌面任务/);
  assert.doesNotMatch(summary.finalMessage, /旧桌面任务/);
});
