import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { observationFilePath } from "../src/config.mjs";
import { CodexSessionObserver } from "../src/observer.mjs";

test("CodexSessionObserver forwards observed progress without per-message title", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-observer-"));
  const sessionPath = path.join(dataDir, "session.jsonl");
  await fs.writeFile(sessionPath, "");

  const state = {
    active: true,
    threadId: "019e0ffb-52e9-7ee3-bb87-42019b58eaa2",
    threadPath: sessionPath,
    cwd: "/workspace",
    name: "Codex short title",
    messageId: "om_observe",
  };
  await fs.writeFile(observationFilePath(dataDir), `${JSON.stringify(state, null, 2)}\n`);

  const replies = [];
  const observer = new CodexSessionObserver({
    config: { dataDir },
    notifier: {
      reply: async (messageId, text) => replies.push({ messageId, text }),
    },
    logger: { warn: () => {} },
  });

  await observer.start(state);
  await fs.appendFile(
    sessionPath,
    [
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "请检查观察输出" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "agent_message", phase: "commentary", message: "正在检查输出逻辑。" } }),
      "",
    ].join("\n"),
  );
  await waitFor(() => replies.length >= 2);
  await observer.stop();

  assert.deepEqual(replies, [
    { messageId: "om_observe", text: "用户提示：\n请检查观察输出" },
    { messageId: "om_observe", text: "正在检查输出逻辑。" },
  ]);
  assert.doesNotMatch(replies.map((reply) => reply.text).join("\n"), /Title:|标题:/);
});

async function waitFor(predicate, timeoutMs = 1500) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for observer reply.");
    await delay(25);
  }
}
