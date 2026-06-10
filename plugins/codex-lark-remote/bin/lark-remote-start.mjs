#!/usr/bin/env node
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const mcpEntrypoint = path.join(scriptDir, "codex-lark-remote-mcp.mjs");
const sdkPackageJson = path.join(pluginRoot, "node_modules", "@larksuiteoapi", "node-sdk", "package.json");

async function hasRuntimeDependencies() {
  try {
    await access(sdkPackageJson);
    return true;
  } catch {
    return false;
  }
}

async function ensureRuntimeDependencies() {
  if (await hasRuntimeDependencies()) return;

  process.stderr.write("Lark Remote is installing runtime dependencies for first use...\n");
  await run(process.platform === "win32" ? "npm.cmd" : "npm", [
    "install",
    "--omit=dev",
    "--package-lock=false",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--silent",
  ], {
    cwd: pluginRoot,
    install: true,
  });

  if (!(await hasRuntimeDependencies())) {
    throw new Error("Lark Remote dependency install completed but @larksuiteoapi/node-sdk is still missing.");
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? pluginRoot,
      env: {
        ...process.env,
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_package_lock: "false",
      },
      stdio: options.install ? ["ignore", "pipe", "pipe"] : "inherit",
    });

    const stdout = [];
    const stderr = [];
    if (options.install) {
      child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
      child.stderr?.on("data", (chunk) => {
        stderr.push(Buffer.from(chunk));
        process.stderr.write(chunk);
      });
    }

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      if (options.install && stdout.length > 0) {
        process.stderr.write(Buffer.concat(stdout).toString("utf8"));
      }
      reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? `exit code ${code ?? 1}`}`));
    });
  });
}

try {
  await ensureRuntimeDependencies();
  await run(process.execPath, [mcpEntrypoint, ...process.argv.slice(2)]);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
