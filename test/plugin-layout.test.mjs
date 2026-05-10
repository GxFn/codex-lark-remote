import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRootUrl = new URL("../", import.meta.url);
const bundleRootUrl = new URL("../plugins/codex-lark-remote/", import.meta.url);
const marketplaceUrl = new URL("../.agents/plugins/marketplace.json", import.meta.url);

const bundledPluginEntries = [
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

const forbiddenRootPluginEntries = [
  ".codex-plugin",
  ".mcp.json",
  "assets",
  "bin",
  "config",
  "skills",
  "src",
];

const readmeEntrypoints = [
  {
    rootUrl: new URL("../README.md", import.meta.url),
    bundledUrl: new URL("../plugins/codex-lark-remote/README.md", import.meta.url),
    language: "English",
  },
  {
    rootUrl: new URL("../README.zh-CN.md", import.meta.url),
    bundledUrl: new URL("../plugins/codex-lark-remote/README.zh-CN.md", import.meta.url),
    language: "Chinese",
  },
];

test("keeps Codex marketplace metadata pointed at the plugin bundle", async () => {
  const marketplace = JSON.parse(await fs.readFile(marketplaceUrl, "utf8"));
  assert.equal(marketplace.name, "gxfn");
  assert.equal(marketplace.interface?.displayName, "GxFn");
  assert.equal(marketplace.plugins[0]?.name, "codex-lark-remote");
  assert.equal(marketplace.plugins[0]?.source?.source, "local");
  assert.equal(marketplace.plugins[0]?.source?.path, "./plugins/codex-lark-remote");
});

test("keeps the plugin bundle as the single source of plugin code", async () => {
  const bundleRootStat = await fs.lstat(bundleRootUrl);
  assert.equal(bundleRootStat.isDirectory(), true, "plugin bundle must live under plugins/codex-lark-remote");
  assert.equal(bundleRootStat.isSymbolicLink(), false, "plugin bundle must be a real directory");

  for (const entry of bundledPluginEntries) {
    const bundledPath = path.join(bundleRootUrl.pathname, entry);
    const bundledStat = await fs.lstat(bundledPath);
    assert.equal(bundledStat.isSymbolicLink(), false, `${entry} must be a real bundled file or directory`);
  }

  for (const entry of forbiddenRootPluginEntries) {
    const rootPath = path.join(repoRootUrl.pathname, entry);
    await assert.rejects(fs.lstat(rootPath), { code: "ENOENT" }, `${entry} should not exist at repo root`);
  }
});

test("keeps root READMEs as short entrypoints to bundled plugin docs", async () => {
  for (const { rootUrl, bundledUrl, language } of readmeEntrypoints) {
    const rootReadme = await fs.readFile(rootUrl, "utf8");
    const bundledReadme = await fs.readFile(bundledUrl, "utf8");

    assert.notEqual(rootReadme, bundledReadme, `${language} root README must not duplicate bundled plugin docs`);
    assert.match(rootReadme, /plugins\/codex-lark-remote\//, `${language} root README must point at the bundle`);
    assert.match(
      rootReadme,
      /plugins\/codex-lark-remote\/README\.md/,
      `${language} root README must link to English plugin docs`,
    );
    assert.match(
      rootReadme,
      /plugins\/codex-lark-remote\/README\.zh-CN\.md/,
      `${language} root README must link to Chinese plugin docs`,
    );

    const rootLineCount = rootReadme.trim().split(/\n/).length;
    assert.ok(rootLineCount <= 20, `${language} root README should stay short`);
    assert.ok(rootReadme.length < bundledReadme.length / 2, `${language} root README should not copy the full docs`);
  }
});

test("keeps startup guidance on the plugin MCP path", async () => {
  const skill = await fs.readFile(
    new URL("../plugins/codex-lark-remote/skills/codex-lark-remote/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.match(skill, /Use the plugin MCP tools only/);
  assert.match(skill, /fall back to shell commands/);
  assert.match(skill, /plugin MCP server is not loaded/);
});

test("declares a plugin-root cwd for the MCP server", async () => {
  const config = JSON.parse(await fs.readFile(new URL("../plugins/codex-lark-remote/.mcp.json", import.meta.url), "utf8"));
  const server = config.mcpServers?.["codex-lark-remote"];

  assert.equal(server?.command, "npx");
  assert.deepEqual(server?.args, [
    "-y",
    "--package",
    "@larksuiteoapi/node-sdk@1.63.1",
    "node",
    "./bin/codex-lark-remote-mcp.mjs",
  ]);
  assert.equal(server?.cwd, ".");
});
