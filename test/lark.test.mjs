import test from "node:test";
import assert from "node:assert/strict";
import { classifyChatText, configuredAllowedUsers, isUserAllowed, parseLarkEvent, parseLarkCardAction } from "../plugins/codex-lark-remote/src/lark.mjs";

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

  assert.deepEqual(classifyChatText("status rcmd_1", config), {
    kind: "task_status",
    id: "rcmd_1",
  });

  assert.deepEqual(classifyChatText("/codex commands on", config), {
    kind: "command_visibility",
    enabled: true,
  });

  assert.deepEqual(classifyChatText("commands on", config), {
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

  assert.deepEqual(classifyChatText("whoami", config), {
    kind: "whoami",
  });

  assert.deepEqual(classifyChatText("/codex handoff", config), {
    kind: "handoff_status",
  });

  assert.deepEqual(classifyChatText("/codex handoff off", config), {
    kind: "handoff_disable",
  });

  assert.deepEqual(classifyChatText("/codex observe", config), {
    kind: "observe_list",
  });

  assert.deepEqual(classifyChatText("observe", config), {
    kind: "observe_list",
  });

  assert.deepEqual(classifyChatText("/codex observe 列表", config), {
    kind: "observe_list",
  });

  assert.deepEqual(classifyChatText("/codex observe 2", config), {
    kind: "observe_enable",
    selector: "2",
  });

  assert.deepEqual(classifyChatText("/codex observe off", config), {
    kind: "observe_disable",
  });

  assert.deepEqual(classifyChatText("/codex takeover", config), {
    kind: "takeover_list",
  });

  assert.deepEqual(classifyChatText("/codex windows", config), {
    kind: "takeover_list",
  });

  assert.deepEqual(classifyChatText("windows", config), {
    kind: "takeover_list",
  });

  assert.deepEqual(classifyChatText("/codex projects 2", config), {
    kind: "takeover_project_select",
    selector: "2",
  });

  assert.deepEqual(classifyChatText("/codex takeover 2", config), {
    kind: "takeover_select",
    selector: "2",
  });

  assert.deepEqual(classifyChatText("/codex takeover 2 now", config), {
    kind: "takeover_execute",
    selector: "2",
  });

  assert.deepEqual(classifyChatText("takeover 2 now", config), {
    kind: "takeover_execute",
    selector: "2",
  });

  assert.deepEqual(classifyChatText("/codex takeover now", config), {
    kind: "takeover_execute",
  });

  assert.deepEqual(classifyChatText("/codex takeover off", config), {
    kind: "takeover_disable",
  });

  assert.deepEqual(classifyChatText("/codex handoff disconnect", config), {
    kind: "handoff_disable",
  });

  assert.deepEqual(classifyChatText("/codex bridge stop", config), {
    kind: "bridge_stop_confirm",
  });

  assert.deepEqual(classifyChatText("断开连接吧", config), {
    kind: "bridge_stop_confirm",
  });

  assert.deepEqual(classifyChatText("关闭飞书连接", config), {
    kind: "bridge_stop_confirm",
  });

  assert.deepEqual(classifyChatText("断开接管吧", config), {
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

  assert.deepEqual(classifyChatText("还在跑吗", config), {
    kind: "status",
  });

  assert.deepEqual(classifyChatText("现在在干嘛", config), {
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

  assert.deepEqual(classifyChatText("观察列表", config), {
    kind: "observe_list",
  });

  assert.deepEqual(classifyChatText("窗口列表", config), {
    kind: "takeover_window_list",
  });

  assert.deepEqual(classifyChatText("会话列表", config), {
    kind: "takeover_window_list",
  });

  assert.deepEqual(classifyChatText("项目列表", config), {
    kind: "takeover_list",
  });

  assert.deepEqual(classifyChatText("进入第一个项目", config), {
    kind: "takeover_project_select",
    selector: "1",
  });

  assert.deepEqual(classifyChatText("进入项目 1", config), {
    kind: "takeover_project_select",
    selector: "1",
  });

  assert.deepEqual(classifyChatText("选择第 2 个项目", config), {
    kind: "takeover_project_select",
    selector: "2",
  });

  assert.deepEqual(classifyChatText("查看第 3 个窗口", config), {
    kind: "takeover_select",
    selector: "3",
  });

  assert.deepEqual(classifyChatText("执行接管", config), {
    kind: "takeover_execute",
  });

  assert.deepEqual(classifyChatText("接管第 2 个窗口", config), {
    kind: "takeover_execute",
    selector: "2",
  });

  assert.deepEqual(classifyChatText("接管 1", config), {
    kind: "takeover_execute",
    selector: "1",
  });

  assert.deepEqual(classifyChatText("观察第 2 个窗口", config), {
    kind: "observe_enable",
    selector: "2",
  });

  assert.deepEqual(classifyChatText("串流第三个", config), {
    kind: "observe_enable",
    selector: "3",
  });

  assert.deepEqual(classifyChatText("关闭观察", config), {
    kind: "observe_disable",
  });

  assert.deepEqual(classifyChatText("打开命令显示", config), {
    kind: "command_visibility",
    enabled: true,
  });

  assert.deepEqual(classifyChatText("显示终端输出", config), {
    kind: "command_visibility",
    enabled: true,
  });

  assert.deepEqual(classifyChatText("不要显示命令了", config), {
    kind: "command_visibility",
    enabled: false,
  });

  assert.deepEqual(classifyChatText("别刷命令了", config), {
    kind: "command_visibility",
    enabled: false,
  });

  assert.deepEqual(classifyChatText("不要接管了", config), {
    kind: "handoff_disable",
  });

  assert.deepEqual(classifyChatText("关掉插件", config), {
    kind: "bridge_stop_confirm",
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

test("parseLarkCardAction extracts card action payloads", () => {
  const parsed = parseLarkCardAction({
    header: { event_type: "card.action.trigger" },
    event: {
      action: {
        value: {
          action: "takeover_execute",
          optionIndex: 1,
          threadId: "thread-a",
        },
      },
      context: {
        open_message_id: "om_card",
        open_chat_id: "oc_card",
      },
      operator: {
        operator_id: { user_id: "ou_user", open_id: "ou_open" },
      },
    },
  });

  assert.equal(parsed.kind, "card_action");
  assert.equal(parsed.action, "takeover_execute");
  assert.equal(parsed.value.optionIndex, 1);
  assert.equal(parsed.messageId, "om_card");
  assert.equal(parsed.senderId, "ou_user");
  assert.match(parsed.chatIdHash, /^c_[a-f0-9]{12}$/);
});

test("parseLarkCardAction accepts flattened SDK card callback identity", () => {
  const parsed = parseLarkCardAction({
    header: { event_type: "card.action.trigger" },
    context: {
      open_message_id: "om_card",
      open_chat_id: "oc_card",
    },
    operator: {
      open_id: "ou_open_user",
      user_id: "user_123",
      union_id: "on_union",
    },
    action: {
      value: { action: "takeover_view", optionIndex: 1 },
      tag: "button",
    },
  });

  assert.equal(parsed.kind, "card_action");
  assert.equal(parsed.senderId, "user_123");
  assert.equal(parsed.openId, "ou_open_user");
  assert.equal(parsed.unionId, "on_union");
  assert.equal(parsed.messageId, "om_card");
  assert.equal(parsed.chatId, "oc_card");
});

test("parseLarkCardAction accepts legacy card callback open_id identity", () => {
  const parsed = parseLarkCardAction({
    type: "card.action.trigger",
    open_id: "ou_open_user",
    open_message_id: "om_card",
    action: {
      value: { action: "takeover_view" },
      tag: "button",
    },
  });

  assert.equal(parsed.senderId, "ou_open_user");
  assert.equal(parsed.senderIdType, "open_id");
  assert.equal(parsed.openId, "ou_open_user");
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

test("isUserAllowed accepts any parsed Feishu identity on an event", () => {
  const config = { lark: { allowedUsers: ["ou_open_allowed"] } };

  assert.equal(isUserAllowed({
    senderId: "user_id_not_allowed",
    openId: "ou_open_allowed",
    unionId: "on_union",
  }, config), true);
  assert.equal(isUserAllowed({
    senderId: "user_id_not_allowed",
    openId: "ou_open_blocked",
    unionId: "on_union",
  }, config), false);
});
