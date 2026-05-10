#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = new URL("../", import.meta.url);
const bundleRoot = new URL("../plugins/codex-lark-remote/", import.meta.url);

const entries = [
  ".codex-plugin",
  ".mcp.json",
  "README.md",
  "README.zh-CN.md",
  "assets",
  "bin",
  "config",
  "package-lock.json",
  "package.json",
  "skills",
  "src",
];

await fs.mkdir(bundleRoot, { recursive: true });

for (const entry of entries) {
  const source = path.join(repoRoot.pathname, entry);
  const target = path.join(bundleRoot.pathname, entry);
  await fs.rm(target, { recursive: true, force: true });
  await fs.cp(source, target, { recursive: true, verbatimSymlinks: false });
}

process.stdout.write(`Synced ${entries.length} entries to plugins/codex-lark-remote\n`);
