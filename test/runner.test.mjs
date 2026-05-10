import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCodexExecArgs,
  buildCodexResumeArgs,
  buildHandoffPrompt,
  extractFinalMessage,
  extractProgressSummary,
  summarizeCodexEvent,
} from "../plugins/codex-lark-remote/src/runner.mjs";

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

  assert.equal(prompt, "fix README");
});

test("buildHandoffPrompt can still annotate Feishu input when configured", () => {
  const prompt = buildHandoffPrompt({
    userName: "ou_user",
    userIdHash: "u_hash",
    prompt: "fix README",
  }, { promptStyle: "annotated" });

  assert.match(prompt, /Codex Lark Remote handoff/);
  assert.match(prompt, /Feishu\/Lark/);
  assert.match(prompt, /fix README/);
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
    "Ran command: npm test\nOutput: 51 passed",
  );
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
      type: "event_msg",
      payload: { type: "agent_message", phase: "commentary", message: "我会先检查文件。" },
    }),
    "Codex: 我会先检查文件。",
  );
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
      "Started working on the Feishu/Lark message.",
      "Ran command: npm test\nOutput: ok",
      "Codex turn completed. Tokens: input=10 output=20",
    ].join("\n"),
  );
});
