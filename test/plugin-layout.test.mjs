import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRootUrl = new URL("../", import.meta.url);
const bundleRootUrl = new URL("../plugins/codex-lark-remote/", import.meta.url);
const marketplaceUrl = new URL("../.agents/plugins/marketplace.json", import.meta.url);

const mirroredEntries = [
  ".codex-plugin",
  ".mcp.json",
  "README.md",
  "bin",
  "config",
  "package-lock.json",
  "package.json",
  "skills",
  "src",
];

test("keeps Codex marketplace metadata pointed at the plugin bundle", async () => {
  const marketplace = JSON.parse(await fs.readFile(marketplaceUrl, "utf8"));
  assert.equal(marketplace.name, "codex-lark-remote");
  assert.equal(marketplace.plugins[0]?.name, "codex-lark-remote");
  assert.equal(marketplace.plugins[0]?.source?.source, "local");
  assert.equal(marketplace.plugins[0]?.source?.path, "./plugins/codex-lark-remote");
});

test("keeps the local Codex plugin bundle in sync with the root implementation", async () => {
  for (const entry of mirroredEntries) {
    const rootPath = path.join(repoRootUrl.pathname, entry);
    const bundledPath = path.join(bundleRootUrl.pathname, entry);

    const rootStat = await fs.lstat(rootPath);
    const bundledStat = await fs.lstat(bundledPath);
    assert.equal(bundledStat.isSymbolicLink(), false, `${entry} must be a real bundled file or directory`);

    if (rootStat.isFile()) {
      const rootText = await fs.readFile(rootPath, "utf8");
      const bundledText = await fs.readFile(bundledPath, "utf8");
      assert.equal(bundledText, rootText, `${entry} drifted from the root implementation`);
      continue;
    }

    const rootFiles = await listFiles(rootPath);
    const bundledFiles = await listFiles(bundledPath);
    assert.deepEqual(bundledFiles, rootFiles, `${entry} file list drifted from the root implementation`);

    for (const relativePath of rootFiles) {
      const rootText = await fs.readFile(path.join(rootPath, relativePath), "utf8");
      const bundledText = await fs.readFile(path.join(bundledPath, relativePath), "utf8");
      assert.equal(bundledText, rootText, `${entry}/${relativePath} drifted from the root implementation`);
    }
  }
});

async function listFiles(targetPath, basePath = targetPath) {
  const stat = await fs.lstat(targetPath);
  if (stat.isSymbolicLink()) return [`${path.relative(basePath, targetPath)} -> symlink`];
  if (stat.isFile()) return [path.relative(basePath, targetPath)];

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const childPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(childPath, basePath)));
    else files.push(path.relative(basePath, childPath));
  }
  return files.sort();
}
