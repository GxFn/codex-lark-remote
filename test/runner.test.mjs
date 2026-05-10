import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexExecArgs, extractFinalMessage } from "../src/runner.mjs";

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

test("extractFinalMessage reads Codex JSONL agent messages", () => {
  const stdout = [
    JSON.stringify({ type: "item.completed", item: { type: "command_execution", aggregated_output: "npm test" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Status: waiting_review\n\nSummary:\n- done" } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1 } }),
  ].join("\n");

  assert.equal(extractFinalMessage(stdout), "Status: waiting_review\n\nSummary:\n- done");
});
