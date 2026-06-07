import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(new URL("../", import.meta.url).pathname);
const scriptPath = path.join(repoRoot, "scripts", "sync-gxfn-marketplace.mjs");
const pluginRoot = repoRoot;

test("sync-gxfn-marketplace dry-run reports stale targets without modifying them", async () => {
  const marketplaceDir = await fixtureMarketplace();
  const targetManifestPath = path.join(
    marketplaceDir,
    "plugins",
    "codex-lark-remote",
    ".codex-plugin",
    "plugin.json",
  );

  const result = spawnSync(
    process.execPath,
    [scriptPath, "--dry-run", "--marketplace-dir", marketplaceDir, "--plugin-root", pluginRoot],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run only/);
  assert.match(result.stdout, /Existing target has codex-lark-remote@0\.0\.1/);

  const targetManifest = JSON.parse(await fs.readFile(targetManifestPath, "utf8"));
  assert.equal(targetManifest.version, "0.0.1");
});

test("sync-gxfn-marketplace copies and verifies the plugin on real sync", async () => {
  const marketplaceDir = await fixtureMarketplace();

  const result = spawnSync(
    process.execPath,
    [scriptPath, "--marketplace-dir", marketplaceDir, "--plugin-root", pluginRoot],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified codex-lark-remote@0\.2\.6/);

  const targetManifest = JSON.parse(
    await fs.readFile(
      path.join(marketplaceDir, "plugins", "codex-lark-remote", ".codex-plugin", "plugin.json"),
      "utf8",
    ),
  );
  assert.equal(targetManifest.version, "0.2.6");
  assert.equal(targetManifest.interface?.developerName, "GxFn");
});

async function fixtureMarketplace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-lark-marketplace-"));
  await fs.mkdir(path.join(root, ".agents", "plugins"), { recursive: true });
  await fs.mkdir(path.join(root, "plugins", "codex-lark-remote", ".codex-plugin"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".agents", "plugins", "marketplace.json"),
    JSON.stringify(
      {
        name: "gxfn",
        plugins: [
          {
            name: "codex-lark-remote",
            source: {
              source: "local",
              path: "./plugins/codex-lark-remote",
            },
            policy: {
              installation: "AVAILABLE",
              authentication: "ON_INSTALL",
            },
            category: "Productivity",
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  await fs.writeFile(
    path.join(root, "plugins", "codex-lark-remote", ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "codex-lark-remote", version: "0.0.1" }, null, 2) + "\n",
  );
  return root;
}
