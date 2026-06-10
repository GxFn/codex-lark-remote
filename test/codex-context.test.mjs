import test from "node:test";
import assert from "node:assert/strict";
import { applyCodexContext, extractCodexContext } from "../plugins/codex-lark-remote/src/codex-context.mjs";

test("extractCodexContext reads current thread id from request metadata", () => {
  const request = {
    params: {
      _meta: {
        codex: {
          threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
          threadPath: "/sessions/rollout.jsonl",
          cwd: "/workspace",
        },
      },
    },
  };

  assert.deepEqual(extractCodexContext(request, {}), {
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    threadPath: "/sessions/rollout.jsonl",
    cwd: "/workspace",
    source: "params._meta.codex.threadId",
  });
});

test("applyCodexContext keeps explicit thread id over metadata", () => {
  const args = applyCodexContext(
    { threadId: "explicit-thread", cwd: "/explicit" },
    { params: { _meta: { codex: { threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2" } } } },
    {},
  );

  assert.equal(args.threadId, "explicit-thread");
  assert.equal(args.cwd, "/explicit");
});

test("extractCodexContext derives thread id from exact session path", () => {
  const request = {
    params: {
      _meta: {
        codex: {
          sessionPath: "/Users/me/.codex/sessions/2026/05/11/rollout-2026-05-11T08-00-00-019e0ffb-52e9-7ee3-bb87-42019b58eaa2.jsonl",
          cwd: "/workspace",
        },
      },
    },
  };

  const context = extractCodexContext(request, {});

  assert.equal(context.threadId, "019e0ffb-52e9-7ee3-bb87-42019b58eaa2");
  assert.equal(context.threadPath, request.params._meta.codex.sessionPath);
  assert.equal(context.cwd, "/workspace");
});
