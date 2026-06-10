import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRootUrl = new URL("../", import.meta.url);
const pluginRootUrl = new URL("../plugins/codex-lark-remote/", import.meta.url);
const marketplaceUrl = new URL("../.agents/plugins/marketplace.json", import.meta.url);

const bundledPluginEntries = [
  ".codex-plugin",
  ".mcp.json",
  "AGENTS.md",
  "README.md",
  "README.zh-CN.md",
  "assets",
  "bin",
  "config",
  "package.json",
  "skills",
  "src",
];

const forbiddenPluginEntries = [
  "docs",
  "node_modules",
  "runtime.tgz",
  "scripts",
  "test",
];

const forbiddenRootPluginEntries = [
  ".codex-plugin",
  ".mcp.json",
  "AGENTS.md",
  "assets",
  "bin",
  "config",
  "skills",
  "src",
  "runtime.tgz",
];

const readmePairs = [
  {
    rootUrl: new URL("../README.md", import.meta.url),
    bundledUrl: new URL("../plugins/codex-lark-remote/README.md", import.meta.url),
    language: "English",
    requiredRootPatterns: [
      /## Install/,
      /## Start With The Console/,
      /## Configure Feishu\/Lark/,
      /## Start From Codex/,
      /plugins\/codex-lark-remote/,
      /https:\/\/github\.com\/GxFn\/codex-lark-remote\.git/,
      /lark_configure/,
      /lark_verify_setup/,
      /takeover 1/,
      /clipboard/,
      /\bstatus\b/,
    ],
  },
  {
    rootUrl: new URL("../README.zh-CN.md", import.meta.url),
    bundledUrl: new URL("../plugins/codex-lark-remote/README.zh-CN.md", import.meta.url),
    language: "Chinese",
    requiredRootPatterns: [
      /## 安装/,
      /## 先从控制台开始/,
      /## 配置飞书\/Lark/,
      /## 从 Codex 启动/,
      /plugins\/codex-lark-remote/,
      /https:\/\/github\.com\/GxFn\/codex-lark-remote\.git/,
      /lark_configure/,
      /lark_verify_setup/,
      /接管 1/,
      /已复制/,
      /\bstatus\b/,
    ],
  },
];

test("keeps repository-local marketplace metadata pointed at the nested plugin bundle", async () => {
  const marketplace = JSON.parse(await fs.readFile(marketplaceUrl, "utf8"));
  assert.equal(marketplace.name, "gxfn");
  assert.equal(marketplace.interface?.displayName, "GxFn");
  assert.equal(marketplace.plugins[0]?.name, "codex-lark-remote");
  assert.equal(marketplace.plugins[0]?.source?.source, "local");
  assert.equal(marketplace.plugins[0]?.source?.path, "./plugins/codex-lark-remote");
});

test("keeps the marketplace scan surface limited to the nested plugin bundle", async () => {
  const pluginRootStat = await fs.lstat(pluginRootUrl);
  assert.equal(pluginRootStat.isDirectory(), true, "plugin bundle must live under plugins/codex-lark-remote");
  assert.equal(pluginRootStat.isSymbolicLink(), false, "plugin bundle must be a real directory");

  for (const entry of bundledPluginEntries) {
    const bundledPath = path.join(pluginRootUrl.pathname, entry);
    const bundledStat = await fs.lstat(bundledPath);
    assert.equal(bundledStat.isSymbolicLink(), false, `${entry} must be a real bundled file or directory`);
  }

  for (const entry of forbiddenPluginEntries) {
    const bundledPath = path.join(pluginRootUrl.pathname, entry);
    await assert.rejects(fs.lstat(bundledPath), { code: "ENOENT" }, `${entry} must not ship in the plugin bundle`);
  }

  for (const entry of forbiddenRootPluginEntries) {
    const rootPath = path.join(repoRootUrl.pathname, entry);
    await assert.rejects(fs.lstat(rootPath), { code: "ENOENT" }, `${entry} should not exist at repo root`);
  }
});

test("keeps plugin metadata aligned with repository-local marketplace conventions", async () => {
  const manifest = JSON.parse(
    await fs.readFile(new URL("../plugins/codex-lark-remote/.codex-plugin/plugin.json", import.meta.url), "utf8"),
  );
  const packageJson = JSON.parse(
    await fs.readFile(new URL("../plugins/codex-lark-remote/package.json", import.meta.url), "utf8"),
  );
  const rootPackageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(rootPackageJson.name, "codex-lark-remote-repo");
  assert.deepEqual(rootPackageJson.workspaces, ["plugins/codex-lark-remote"]);

  assert.equal(manifest.name, "codex-lark-remote");
  assert.equal(packageJson.name, "codex-lark-remote");
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.version, "0.3.0");
  assert.equal(manifest.author?.name, "gaoxuefeng");
  assert.equal(manifest.author?.url, "https://github.com/GxFn");
  assert.equal(manifest.homepage, "https://github.com/GxFn/codex-lark-remote#readme");
  assert.equal(manifest.repository, "https://github.com/GxFn/codex-lark-remote");
  assert.equal(manifest.interface?.developerName, "GxFn");
  assert.equal(manifest.interface?.websiteURL, "https://github.com/GxFn/codex-lark-remote#readme");
  assert.deepEqual(manifest.interface?.capabilities, ["Interactive", "Read", "Write"]);
  assert.ok(manifest.keywords.includes("codex-plugin"));
  assert.ok(manifest.keywords.includes("local-first"));

  assert.equal(packageJson.author?.name, manifest.author.name);
  assert.equal(packageJson.author?.url, manifest.author.url);
  assert.equal(packageJson.homepage, manifest.homepage);
  assert.equal(packageJson.repository, manifest.repository);
});

test("keeps full root READMEs alongside bundled plugin docs", async () => {
  for (const { rootUrl, bundledUrl, language, requiredRootPatterns } of readmePairs) {
    const rootReadme = await fs.readFile(rootUrl, "utf8");
    const bundledReadme = await fs.readFile(bundledUrl, "utf8");

    assert.match(rootReadme, /plugins\/codex-lark-remote\//, `${language} root README must point at the bundle`);
    assert.doesNotMatch(rootReadme, /runtime\.tgz/, `${language} root README must not document the rejected tarball path`);
    assert.doesNotMatch(bundledReadme, /runtime\.tgz/, `${language} bundled README must not document the rejected tarball path`);

    const rootLineCount = rootReadme.trim().split(/\n/).length;
    const bundledLineCount = bundledReadme.trim().split(/\n/).length;

    assert.ok(rootLineCount >= 80, `${language} root README should be a full first-time user guide`);
    assert.ok(bundledLineCount >= 60, `${language} bundled README should stay useful inside the plugin package`);

    for (const pattern of requiredRootPatterns) {
      assert.match(rootReadme, pattern, `${language} root README is missing ${pattern}`);
    }
  }
});

test("ships a plugin-bundle agent guide for global Lark Remote behavior", async () => {
  const guide = await fs.readFile(new URL("../plugins/codex-lark-remote/AGENTS.md", import.meta.url), "utf8");

  assert.match(guide, /Global Contract/);
  assert.match(guide, /lark-remote-control-window/);
  assert.match(guide, /lark_route_remote_command/);
  assert.match(guide, /lark_dispatch_remote_command/);
  assert.match(guide, /lark_record_dispatch/);
  assert.match(guide, /lark_reply_remote_command/);
  assert.match(guide, /lark_request_clarification/);
  assert.doesNotMatch(guide, /send_message_to_thread/);
  assert.doesNotMatch(guide, /codex_lark_/);
});

test("documents the current local dispatch architecture without retired main-path concepts", async () => {
  const doc = await fs.readFile(
    new URL("../docs/control-window-dispatch-implementation-plan.md", import.meta.url),
    "utf8",
  );
  const manifest = JSON.parse(
    await fs.readFile(new URL("../plugins/codex-lark-remote/.codex-plugin/plugin.json", import.meta.url), "utf8"),
  );

  assert.match(doc, /local bridge runner/);
  assert.match(doc, /\/bridge\/remote-command\/route/);
  assert.match(doc, /\/bridge\/dispatch\/execute/);
  assert.match(doc, /Retired Main-Path Concepts/);
  assert.match(manifest.interface.longDescription, /local bridge runner/);
  assert.doesNotMatch(manifest.interface.longDescription, /target delivery is executed by the dedicated Lark Remote dispatch MCP/);
  assert.doesNotMatch(doc, /send_message_to_thread/);
  assert.doesNotMatch(doc, /Host thread/i);
  assert.doesNotMatch(doc, /lark_approve_remote_command/);
  assert.doesNotMatch(doc, /control window uses Codex/i);
});

test("keeps startup guidance on the plugin MCP path", async () => {
  const skill = await fs.readFile(
    new URL("../plugins/codex-lark-remote/skills/lark-remote/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.match(skill, /Use Lark Remote MCP tools only/);
  assert.match(skill, /lark_\*/);
  assert.match(skill, /MCP server is not loaded/);
  assert.match(skill, /explicit consent/);
  assert.doesNotMatch(skill, /capabilities/);
});

test("exposes control-window MCP tools and skill guidance", async () => {
  const server = await fs.readFile(
    new URL("../plugins/codex-lark-remote/bin/codex-lark-remote-mcp.mjs", import.meta.url),
    "utf8",
  );
  const controlSkill = await fs.readFile(
    new URL("../plugins/codex-lark-remote/skills/lark-remote-control-window/SKILL.md", import.meta.url),
    "utf8",
  );
  const startupSkill = await fs.readFile(
    new URL("../plugins/codex-lark-remote/skills/lark-remote/SKILL.md", import.meta.url),
    "utf8",
  );
  const requiredTools = [
    "lark_prepare_dispatch",
    "lark_route_remote_command",
    "lark_dispatch_remote_command",
    "lark_record_dispatch",
    "lark_request_clarification",
    "lark_reply_remote_command",
    "lark_get_bridge_status",
    "lark_list_projects",
    "lark_select_project",
    "lark_list_project_sessions",
    "lark_select_target",
    "lark_confirm_takeover",
    "lark_clear_active_target",
    "lark_list_observation_targets",
    "lark_start_observation",
    "lark_stop_observation",
    "lark_unlock_control_window",
  ];

  for (const toolName of requiredTools) {
    assert.match(server, new RegExp(`name: "${toolName}"`), `${toolName} must be declared`);
    assert.match(server, new RegExp(`name === "${toolName}"`), `${toolName} must be callable`);
    assert.match(controlSkill, new RegExp(toolName), `${toolName} must be documented for the control window`);
  }

  assert.match(controlSkill, /remoteCommandId/);
  assert.match(controlSkill, /lark_route_remote_command/);
  assert.match(controlSkill, /toolInput/);
  assert.match(controlSkill, /completionToolInput/);
  assert.match(controlSkill, /Full Lifecycle/);
  assert.match(controlSkill, /lark_dispatch_remote_command/);
  assert.match(controlSkill, /lark_prepare_dispatch/);
  assert.match(controlSkill, /lark_record_dispatch/);
  assert.match(startupSkill, /lark_dispatch_remote_command/);
  assert.doesNotMatch(server, /name: "lark_context"/);
  assert.doesNotMatch(server, /name: "lark_send"/);
  assert.doesNotMatch(server, /name: "lark_approve"/);
  assert.doesNotMatch(controlSkill, /lark_context/);
});

test("declares a direct plugin-bundle MCP server without the rejected runtime tarball wrapper", async () => {
  const config = JSON.parse(
    await fs.readFile(new URL("../plugins/codex-lark-remote/.mcp.json", import.meta.url), "utf8"),
  );
  const server = config.mcpServers?.["lark-remote"];

  assert.equal(server?.command, "node");
  assert.deepEqual(server?.args, [
    "./bin/codex-lark-remote-mcp.mjs",
  ]);
  assert.equal(server?.cwd, ".");
  assert.equal(server?.default_tools_approval_mode, "approve");
});

test("keeps example runner config compatible with plugin tools", async () => {
  const config = JSON.parse(
    await fs.readFile(new URL("../plugins/codex-lark-remote/config/example.config.json", import.meta.url), "utf8"),
  );

  assert.equal(config.runner?.ignoreUserConfig, false);
});

test("requires explicit consent for conversation handoff", async () => {
  const server = await fs.readFile(
    new URL("../plugins/codex-lark-remote/bin/codex-lark-remote-mcp.mjs", import.meta.url),
    "utf8",
  );

  assert.match(server, /confirmedLocalBridgeHandoff/);
  assert.doesNotMatch(server, /confirmedExternalHandoff/);
  assert.match(server, /handoff requires explicit consent/);
  assert.match(server, /allowed Feishu\/Lark users choose the project and window/);
  assert.match(server, /attaches this Codex window as the control window/);
  assert.match(server, /bridgeFetch\(state, "\/bridge\/handoff"/);
  assert.match(server, /activatedBy: "mcp-takeover"/);
  assert.match(server, /Control window:/);
  assert.match(server, /queryParams\.set\("cwd", args\.cwd\)/);
  assert.match(server, /Existing chat history is not sent to Feishu\/Lark/);
  assert.doesNotMatch(server, /exports the current conversation/);
  assert.doesNotMatch(server, /sending this Codex conversation/);
});

test("keeps startup tools from circular start and handoff guidance", async () => {
  const server = await fs.readFile(
    new URL("../plugins/codex-lark-remote/bin/codex-lark-remote-mcp.mjs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(server, /Use lark_start first/);
  assert.match(server, /formatBridgeStartFailure\(bridge, "start"\)/);
  assert.match(server, /formatBridgeStartFailure\(bridge, "handoff"\)/);
  assert.match(server, /formatBridgeStartFailure\(bridge, "takeover preparation"\)/);
  assert.match(server, /No separate pre-start step is required/);
});

test("keeps bridge runtime isolated from the MCP stdio process", async () => {
  const server = await fs.readFile(
    new URL("../plugins/codex-lark-remote/bin/codex-lark-remote-mcp.mjs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(server, /startBridge\s*\(/);
  assert.doesNotMatch(server, /embeddedBridge/);
  assert.match(server, /startBridgeProcess\(args\)/);
});
