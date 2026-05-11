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
  summarizeCodexEvent,
  summarizeSessionProgressEvent,
} from "../plugins/codex-lark-remote/src/runner.mjs";
import { activateHandoff } from "../plugins/codex-lark-remote/src/handoff.mjs";

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

test("buildHandoffPrompt sends Feishu input as direct Codex conversation text by default", () => {
  const prompt = buildHandoffPrompt({
    userName: "ou_user",
    userIdHash: "u_hash",
    prompt: "fix README",
  });

  assert.match(prompt, /^fix README/);
  assert.match(prompt, /Feishu\/Lark cannot click native Codex Desktop permission dialogs/);
  assert.match(prompt, /Reply with a concise prompt explaining what permission is needed/);
});

test("buildHandoffPrompt can still annotate Feishu input when configured", () => {
  const prompt = buildHandoffPrompt({
    userName: "ou_user",
    userIdHash: "u_hash",
    prompt: "fix README",
  }, { promptStyle: "annotated" });

  assert.match(prompt, /Codex Lark Remote handoff/);
  assert.match(prompt, /Feishu\/Lark/);
  assert.match(prompt, /Permission boundary:/);
  assert.match(prompt, /fix README/);
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

  assert.deepEqual(replies.find((reply) => reply.text === "Started working on the Feishu/Lark message."), {
    messageId: "om_1",
    text: "Started working on the Feishu/Lark message.",
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

  assert.equal(replies.some((reply) => reply.text === "Started working on the Feishu/Lark message."), false);
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

test("formatPermissionBoundaryNotice explains approval UI boundaries", () => {
  const text = formatPermissionBoundaryNotice("This action was rejected due to unacceptable risk.");

  assert.match(text, /Permission needed/);
  assert.match(text, /cannot click Codex Desktop permission dialogs/);
  assert.match(text, /Codex security review blocked the action/);
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

test("summarizeSessionProgressEvent only forwards assistant progress messages", () => {
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

test("extractProgressSummary collects non-chat Codex JSONL events", () => {
  const stdout = [
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "npm test", aggregated_output: "ok" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "final answer" } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 20 } }),
  ].join("\n");

  assert.equal(
    extractProgressSummary(stdout),
    [
      "Codex turn completed. Tokens: input=10 output=20",
    ].join("\n"),
  );
  assert.equal(
    extractProgressSummary(stdout, { showCommands: true }),
    [
      "Ran command:\nnpm test\nOutput:\nok",
      "Codex turn completed. Tokens: input=10 output=20",
    ].join("\n"),
  );
});
