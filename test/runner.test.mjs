import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexExecArgs, buildCodexResumeArgs, buildHandoffPrompt, extractFinalMessage } from "../plugins/codex-lark-remote/src/runner.mjs";

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

test("buildCodexResumeArgs resumes a Codex thread without worktree flags", () => {
  const args = buildCodexResumeArgs({
    runner: { ignoreUserConfig: true, model: "gpt-test" },
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    prompt: "continue from lark",
    outputFile: "/tmp/final.txt",
  });

  assert.deepEqual(args, [
    "exec",
    "resume",
    "--json",
    "--ignore-user-config",
    "-m",
    "gpt-test",
    "-o",
    "/tmp/final.txt",
    "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    "continue from lark",
  ]);
  assert.equal(args.includes("-C"), false);
  assert.equal(args.includes("--sandbox"), false);
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
