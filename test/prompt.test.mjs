import test from "node:test";
import assert from "node:assert/strict";
import { buildRunnerPrompt } from "../src/prompt.mjs";

test("buildRunnerPrompt includes Lark remote context and safety contract", () => {
  const prompt = buildRunnerPrompt(
    {
      id: "rcmd_1",
      repoKey: "demo",
      projectRoot: "/repo",
      worktreePath: "/worktree",
      branchName: "codex-lark/rcmd_1",
      userIdHash: "u_123",
      userName: "Gao",
      messageId: "om_secret",
      chatIdHash: "c_123",
      prompt: "fix tests",
      normalizedTask: "fix tests",
    },
    {
      repos: { demo: {} },
      runner: { sandbox: "workspace-write" },
      policy: { requireReviewForCommit: true, requireReviewForPush: true, maxResultChars: 3000 },
    },
  );

  assert.match(prompt, /Use the codex-lark-remote skill/);
  assert.match(prompt, /<codex_lark_remote_context>/);
  assert.match(prompt, /worktree_path: \/worktree/);
  assert.match(prompt, /require_review_for_commit: true/);
  assert.match(prompt, /feishu_lark_cannot_click_codex_desktop_permission_ui: true/);
  assert.match(prompt, /if_permission_or_approval_is_required: send_a_clear_lark_prompt_instead_of_waiting/);
  assert.doesNotMatch(prompt, /om_secret/);
});
