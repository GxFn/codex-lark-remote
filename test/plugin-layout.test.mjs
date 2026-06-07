import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRootUrl = new URL("../", import.meta.url);
const marketplaceUrl = new URL("../.agents/plugins/marketplace.json", import.meta.url);

const rootPluginEntries = [
  ".codex-plugin",
  ".mcp.json",
  "README.md",
  "README.zh-CN.md",
  "assets",
  "bin",
  "config",
  "package.json",
  "skills",
  "src",
];

const readmePairs = [
  {
    rootUrl: new URL("../README.md", import.meta.url),
    language: "English",
    requiredRootPatterns: [
      /## Install/,
      /## Start With The Console/,
      /## Configure Feishu\/Lark/,
      /## Start From Codex/,
      /https:\/\/github\.com\/GxFn\/codex-lark-remote\.git/,
      /codex_lark_configure/,
      /codex_lark_verify_setup/,
      /takeover 1/,
      /clipboard/,
      /\bstatus\b/,
    ],
  },
  {
    rootUrl: new URL("../README.zh-CN.md", import.meta.url),
    language: "Chinese",
    requiredRootPatterns: [
      /## 安装/,
      /## 先从控制台开始/,
      /## 配置飞书\/Lark/,
      /## 从 Codex 启动/,
      /https:\/\/github\.com\/GxFn\/codex-lark-remote\.git/,
      /codex_lark_configure/,
      /codex_lark_verify_setup/,
      /接管 1/,
      /已复制/,
      /\bstatus\b/,
    ],
  },
];

test("keeps Codex marketplace metadata pointed at the plugin bundle", async () => {
  const marketplace = JSON.parse(await fs.readFile(marketplaceUrl, "utf8"));
  assert.equal(marketplace.name, "gxfn");
  assert.equal(marketplace.interface?.displayName, "GxFn");
  assert.equal(marketplace.plugins[0]?.name, "codex-lark-remote");
  assert.equal(marketplace.plugins[0]?.source?.source, "local");
  assert.equal(marketplace.plugins[0]?.source?.path, ".");
});

test("keeps plugin metadata aligned with the GxFn marketplace conventions", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL("../.codex-plugin/plugin.json", import.meta.url), "utf8"));
  const packageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(manifest.author?.name, "GxFn");
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

test("keeps the repository root as the plugin root", async () => {
  const rootStat = await fs.lstat(repoRootUrl);
  assert.equal(rootStat.isDirectory(), true, "plugin root must be the repository root");
  assert.equal(rootStat.isSymbolicLink(), false, "plugin root must be a real directory");

  for (const entry of rootPluginEntries) {
    const rootPath = path.join(repoRootUrl.pathname, entry);
    const entryStat = await fs.lstat(rootPath);
    assert.equal(entryStat.isSymbolicLink(), false, `${entry} must be a real plugin-root file or directory`);
  }
});

test("keeps full plugin-root READMEs", async () => {
  for (const { rootUrl, language, requiredRootPatterns } of readmePairs) {
    const rootReadme = await fs.readFile(rootUrl, "utf8");
    assert.doesNotMatch(rootReadme, /plugins\/codex-lark-remote\//, `${language} README must not point at a nested bundle`);

    const rootLineCount = rootReadme.trim().split(/\n/).length;

    assert.ok(rootLineCount >= 80, `${language} root README should be a full first-time user guide`);

    for (const pattern of requiredRootPatterns) {
      assert.match(rootReadme, pattern, `${language} root README is missing ${pattern}`);
    }
  }
});

test("keeps startup guidance on the plugin MCP path", async () => {
  const skill = await fs.readFile(
    new URL("../skills/codex-lark-remote/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.match(skill, /Use the plugin MCP tools only/);
  assert.match(skill, /fall back to shell commands/);
  assert.match(skill, /plugin MCP server is not loaded/);
  assert.match(skill, /explicit consent/);
  assert.match(skill, /confirmedLocalBridgeHandoff: true/);
});

test("declares a plugin-root cwd for the MCP server", async () => {
  const config = JSON.parse(await fs.readFile(new URL("../.mcp.json", import.meta.url), "utf8"));
  const server = config.mcpServers?.["codex-lark-remote"];

  assert.equal(server?.command, "node");
  assert.deepEqual(server?.args, [
    "./bin/codex-lark-remote-mcp.mjs",
  ]);
  assert.equal(server?.cwd, ".");
});

test("requires explicit consent for conversation handoff", async () => {
  const server = await fs.readFile(
    new URL("../bin/codex-lark-remote-mcp.mjs", import.meta.url),
    "utf8",
  );

  assert.match(server, /confirmedLocalBridgeHandoff/);
  assert.doesNotMatch(server, /confirmedExternalHandoff/);
  assert.match(server, /handoff requires explicit consent/);
  assert.match(server, /allowed Feishu\/Lark users choose the project and window/);
  assert.match(server, /queryParams\.set\("cwd", args\.cwd\)/);
  assert.match(server, /Existing chat history is not sent to Feishu\/Lark/);
  assert.doesNotMatch(server, /exports the current conversation/);
  assert.doesNotMatch(server, /sending this Codex conversation/);
});

test("keeps startup tools from circular start and handoff guidance", async () => {
  const server = await fs.readFile(
    new URL("../bin/codex-lark-remote-mcp.mjs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(server, /Use codex_lark_start first/);
  assert.match(server, /formatBridgeStartFailure\(bridge, "start"\)/);
  assert.match(server, /formatBridgeStartFailure\(bridge, "handoff"\)/);
  assert.match(server, /formatBridgeStartFailure\(bridge, "takeover preparation"\)/);
  assert.match(server, /No separate pre-start step is required/);
});

test("keeps bridge runtime isolated from the MCP stdio process", async () => {
  const server = await fs.readFile(
    new URL("../bin/codex-lark-remote-mcp.mjs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(server, /startBridge\s*\(/);
  assert.doesNotMatch(server, /embeddedBridge/);
  assert.match(server, /startBridgeProcess\(args\)/);
});
