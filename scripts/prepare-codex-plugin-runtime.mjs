#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const packageJson = readJson(join(root, "package.json"));
const runtimeTarballPath = join(root, "runtime.tgz");

ensureDependenciesInstalled();

const runtimeParent = mkdtempSync(join(tmpdir(), "codex-lark-remote-runtime-"));
const runtimeRoot = join(runtimeParent, "package");
mkdirSync(runtimeRoot, { recursive: true });
try {
  writeRuntimePackageJson();
  copyTree("bin");
  copyTree("src");
  copyTree("config");
  copyFile("README.md", { optional: true });
  copyFile("README.zh-CN.md", { optional: true });
  copyTree("node_modules");
  const packedPath = packRuntimeTarball(runtimeParent);
  rmSync(runtimeTarballPath, { force: true });
  renameSync(packedPath, runtimeTarballPath);

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        runtimeTarballPath,
        package: `${packageJson.name}@${packageJson.version}`,
        entry: "bin/codex-lark-remote-mcp.mjs",
      },
      null,
      2,
    )}\n`,
  );
} finally {
  rmSync(runtimeParent, { force: true, recursive: true });
}

function ensureDependenciesInstalled() {
  const dependencies = Object.keys(packageJson.dependencies || {});
  const missing = dependencies.filter((name) => !existsSync(join(root, "node_modules", ...name.split("/"))));
  if (missing.length === 0) {
    return;
  }

  const result = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      HUSKY: "0",
    },
  });
  if (result.status !== 0) {
    throw new Error(`npm ci failed while preparing Codex plugin runtime\n${result.stdout}\n${result.stderr}`);
  }
}

function writeRuntimePackageJson() {
  const dependencies = packageJson.dependencies || {};
  const runtimePackage = {
    name: packageJson.name,
    version: packageJson.version,
    private: packageJson.private,
    description: `${packageJson.description} Packaged Codex plugin runtime.`,
    type: packageJson.type,
    bin: {
      "codex-lark-remote": "bin/codex-lark-bridge.mjs",
      "codex-lark-remote-mcp": "bin/codex-lark-remote-mcp.mjs",
    },
    keywords: packageJson.keywords,
    author: packageJson.author,
    homepage: packageJson.homepage,
    repository: packageJson.repository,
    license: packageJson.license,
    dependencies,
    overrides: packageJson.overrides,
    bundleDependencies: Object.keys(dependencies),
    bundledDependencies: Object.keys(dependencies),
    engines: packageJson.engines,
    files: [
      "bin",
      "config",
      "node_modules",
      "src",
      "README.md",
      "README.zh-CN.md",
    ],
  };

  writeFileSync(join(runtimeRoot, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`);
}

function packRuntimeTarball(packRoot) {
  const outputRoot = mkdtempSync(join(tmpdir(), "codex-lark-remote-runtime-pack-"));
  const packedPath = join(outputRoot, "runtime.tgz");

  try {
    const result = spawnSync("tar", ["-czf", packedPath, "-C", packRoot, "package"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        HUSKY: "0",
      },
    });
    if (result.status !== 0) {
      throw new Error(`tar Codex plugin runtime failed (${result.status})\n${result.stdout}\n${result.stderr}`);
    }
    return packedPath;
  } catch (error) {
    rmSync(outputRoot, { force: true, recursive: true });
    throw error;
  }
}

function copyTree(relativePath) {
  const source = join(root, relativePath);
  const target = join(runtimeRoot, relativePath);
  if (!existsSync(source)) {
    throw new Error(`Required runtime source path is missing: ${relativePath}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, {
    force: true,
    recursive: true,
    filter(sourcePath) {
      return !sourcePath.includes(`${join(root, "node_modules", ".cache")}`);
    },
  });
}

function copyFile(relativePath, { optional = false } = {}) {
  const source = join(root, relativePath);
  const target = join(runtimeRoot, relativePath);
  if (!existsSync(source)) {
    if (optional) {
      return;
    }
    throw new Error(`Required runtime source file is missing: ${relativePath}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { force: true });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}
