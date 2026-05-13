import test from "node:test";
import assert from "node:assert/strict";
import { buildLarkSetupVerificationReport, verifyLarkSetup } from "../plugins/codex-lark-remote/src/setup-verification.mjs";
import { buildSetupVerificationCard, formatSetupVerification } from "../plugins/codex-lark-remote/src/presenter.mjs";

test("buildLarkSetupVerificationReport separates platform readiness from live event checks", () => {
  const report = buildLarkSetupVerificationReport({
    config: {
      lark: {
        appId: "cli_123456789",
        appSecret: "secret",
        transport: "websocket",
        allowedUsers: ["ou_allowed"],
      },
    },
    auth: { ok: true, hasCredentials: true, appIdPrefix: "cli_1234...", message: "Tenant access token acquired" },
    status: {
      running: true,
      data: {
        larkWs: {
          connected: true,
          message: "Connected via WebSocket",
          lastMessageEventAt: "2026-05-13T12:00:00Z",
          lastCardActionAt: "",
          registeredEvents: ["im.message.receive_v1", "card.action.trigger"],
        },
      },
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.checks.eventLongConnectionReady, true);
  assert.equal(report.checks.callbackLongConnectionReady, true);
  assert.equal(report.checks.messageEventReceived, true);
  assert.equal(report.checks.cardCallbackReceived, false);
  assert.match(formatSetupVerification(report), /事件配置 im\.message\.receive_v1: 已收到消息事件/);
  assert.match(formatSetupVerification(report), /回调配置 card\.action\.trigger: 等待卡片回调/);
  assert.match(formatSetupVerification(report), /先回到 Codex 同意连接当前会话/);
  assert.match(formatSetupVerification(report), /连接生效后再给机器人发送 whoami/);
  assert.match(JSON.stringify(buildSetupVerificationCard(report)), /刷新验证/);
});

test("verifyLarkSetup can start bridge and report websocket readiness without exposing secrets", async () => {
  const report = await verifyLarkSetup({
    loadConfig: async () => ({
      lark: {
        appId: "cli_123456789",
        appSecret: "secret_value",
        transport: "websocket",
      },
    }),
    checkAuth: async () => ({ ok: true, hasCredentials: true, appIdPrefix: "cli_1234...", message: "Tenant access token acquired" }),
    startBridgeProcess: async () => ({ running: true }),
    bridgeStatus: async () => ({
      running: true,
      data: {
        larkWs: {
          connected: true,
          message: "Connected via WebSocket",
          lastMessageEventAt: "",
          lastCardActionAt: "",
        },
      },
    }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.checks.webSocketConnected, true);
  assert.doesNotMatch(formatSetupVerification(report), /secret_value/);
  assert.match(formatSetupVerification(report), /先去飞书后台做长连接配置验证/);
  assert.match(formatSetupVerification(report), /同意连接当前会话/);
});
