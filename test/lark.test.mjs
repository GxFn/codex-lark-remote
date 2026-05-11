import test from "node:test";
import assert from "node:assert/strict";
import { classifyChatText, configuredAllowedUsers, isUserAllowed, parseLarkEvent } from "../plugins/codex-lark-remote/src/lark.mjs";

test("parseLarkEvent extracts text message fields and hashes sensitive ids", () => {
  const parsed = parseLarkEvent({
    event: {
      message: {
        message_id: "om_123",
        chat_id: "oc_secret_chat",
        message_type: "text",
        content: JSON.stringify({ text: "@_user_1 [demo] fix tests" }),
      },
      sender: {
        sender_id: { user_id: "ou_secret_user", open_id: "ou_open_secret", union_id: "on_union_secret" },
      },
    },
  });

  assert.equal(parsed.kind, "message");
  assert.equal(parsed.messageId, "om_123");
  assert.equal(parsed.text, "[demo] fix tests");
  assert.equal(parsed.senderId, "ou_secret_user");
  assert.equal(parsed.senderIdType, "user_id");
  assert.equal(parsed.openId, "ou_open_secret");
  assert.equal(parsed.unionId, "on_union_secret");
  assert.match(parsed.chatIdHash, /^c_[a-f0-9]{12}$/);
  assert.match(parsed.userIdHash, /^u_[a-f0-9]{12}$/);
});

test("classifyChatText recognizes repo prefixes and management commands", () => {
  const config = { defaultRepo: "main", repos: { main: {}, demo: {} } };

  assert.deepEqual(classifyChatText("[demo] fix tests", config), {
    kind: "task",
    forced: false,
    repoKey: "demo",
    taskText: "fix tests",
  });

  assert.deepEqual(classifyChatText("/codex status rcmd_1", config), {
    kind: "task_status",
    id: "rcmd_1",
  });

  assert.deepEqual(classifyChatText("/codex commands on", config), {
    kind: "command_visibility",
    enabled: true,
  });

  assert.deepEqual(classifyChatText("/codex commands off", config), {
    kind: "command_visibility",
    enabled: false,
  });

  assert.deepEqual(classifyChatText("/codex whoami", config), {
    kind: "whoami",
  });

  assert.deepEqual(classifyChatText("/codex handoff", config), {
    kind: "handoff_status",
  });

  assert.deepEqual(classifyChatText("/codex handoff off", config), {
    kind: "handoff_disable",
  });

  assert.deepEqual(classifyChatText("断开连接吧", config), {
    kind: "handoff_disable",
  });

  assert.deepEqual(classifyChatText("停止飞书接管", config), {
    kind: "handoff_disable",
  });

  assert.deepEqual(classifyChatText("状态", config), {
    kind: "status",
  });

  assert.deepEqual(classifyChatText("看下状态", config), {
    kind: "status",
  });

  assert.deepEqual(classifyChatText("我是谁", config), {
    kind: "whoami",
  });

  assert.deepEqual(classifyChatText("帮助", config), {
    kind: "help",
  });

  assert.deepEqual(classifyChatText("接管状态", config), {
    kind: "handoff_status",
  });

  assert.deepEqual(classifyChatText("打开命令显示", config), {
    kind: "command_visibility",
    enabled: true,
  });

  assert.deepEqual(classifyChatText("不要显示命令了", config), {
    kind: "command_visibility",
    enabled: false,
  });

  assert.deepEqual(classifyChatText("不要接管了", config), {
    kind: "handoff_disable",
  });

  assert.deepEqual(classifyChatText("查看任务 rcmd_mozpql6u_e6ca8b55", config), {
    kind: "task_status",
    id: "rcmd_mozpql6u_e6ca8b55",
  });

  assert.deepEqual(classifyChatText("看一下 rcmd_mozpql6u_e6ca8b55 的改动", config), {
    kind: "task_diff",
    id: "rcmd_mozpql6u_e6ca8b55",
  });

  assert.deepEqual(classifyChatText("取消任务 rcmd_mozpql6u_e6ca8b55", config), {
    kind: "cancel",
    id: "rcmd_mozpql6u_e6ca8b55",
  });

  assert.deepEqual(classifyChatText("批准提交 rcmd_mozpql6u_e6ca8b55", config), {
    kind: "approve",
    id: "rcmd_mozpql6u_e6ca8b55",
    action: "commit",
  });

  assert.deepEqual(classifyChatText("批准 rcmd_mozpql6u_e6ca8b55 test", config), {
    kind: "approve",
    id: "rcmd_mozpql6u_e6ca8b55",
    action: "test",
  });

  assert.deepEqual(classifyChatText("写一个帮助文档", config), {
    kind: "task",
    forced: false,
    repoKey: "main",
    taskText: "写一个帮助文档",
  });
});

test("classifyChatText rejects shell mode in MVP", () => {
  const result = classifyChatText("$ rm -rf .", { defaultRepo: "main", repos: { main: {} } });
  assert.equal(result.kind, "rejected");
});

test("isUserAllowed accepts config based allowlists", () => {
  const config = { lark: { allowedUsers: ["ou_allowed"] } };

  assert.deepEqual(configuredAllowedUsers(config), ["ou_allowed"]);
  assert.equal(isUserAllowed("ou_allowed", config), true);
  assert.equal(isUserAllowed("ou_blocked", config), false);
});
