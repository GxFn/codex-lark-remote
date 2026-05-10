#!/usr/bin/env node
import { startBridge } from "../src/bridge-server.mjs";

const args = parseArgs(process.argv.slice(2));
const { url } = await startBridge(args);
process.stdout.write(`codex-lark-remote bridge running at ${url}\n`);

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--port") result.port = Number(argv[++index]);
    else if (item === "--host") result.host = argv[++index];
    else if (item === "--data-dir") result.dataDir = argv[++index];
    else if (item === "--config") result.configPath = argv[++index];
    else if (item === "--token") result.token = argv[++index];
  }
  return result;
}

