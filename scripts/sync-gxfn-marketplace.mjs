#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const args = process.argv.slice(2);

const options = {
  commit: args.includes('--commit'),
  push: args.includes('--push'),
  dryRun: args.includes('--dry-run'),
  marketplaceDir:
    readArg('--marketplace-dir') ||
    process.env.GXFN_CODEX_MARKETPLACE_DIR ||
    resolve(repoRoot, '..', 'GxFnCodexMarketplace'),
  pluginRoot: readArg('--plugin-root') || process.env.CODEX_PLUGIN_ROOT,
};

if (options.dryRun && (options.commit || options.push)) {
  throw new Error('Do not combine --dry-run with --commit or --push');
}

const pluginRoot = detectPluginRoot(options.pluginRoot ? resolve(repoRoot, options.pluginRoot) : repoRoot);
const ignoredRelativePaths = readSyncIgnore(pluginRoot);
const pluginManifestPath = join(pluginRoot, '.codex-plugin', 'plugin.json');
const pluginManifest = readJson(pluginManifestPath);
const pluginName = pluginManifest.name;
const pluginVersion = pluginManifest.version;
const marketplaceDir = resolve(options.marketplaceDir);
const marketplaceManifestPath = join(marketplaceDir, '.agents', 'plugins', 'marketplace.json');
const marketplaceManifest = readJson(marketplaceManifestPath);
const entry = marketplaceManifest.plugins?.find((plugin) => plugin.name === pluginName);

if (!entry) {
  throw new Error(`Marketplace ${marketplaceManifest.name ?? marketplaceDir} has no plugin entry named ${pluginName}`);
}

const targetPath = resolve(marketplaceDir, entry.source?.path ?? '');
const expectedTargetPrefix = resolve(marketplaceDir, 'plugins') + '/';

if (!targetPath.startsWith(expectedTargetPrefix)) {
  throw new Error(`Refusing to sync outside marketplace plugins directory: ${targetPath}`);
}

const targetManifestPath = join(targetPath, '.codex-plugin', 'plugin.json');
const targetDisplay = relative(process.cwd(), targetPath) || targetPath;

console.log(`Syncing ${pluginName}@${pluginVersion}`);
console.log(`  source: ${pluginRoot}`);
console.log(`  target: ${targetPath}`);

if (options.dryRun) {
  console.log('Dry run only; no files changed.');
} else {
  rmSync(targetPath, { recursive: true, force: true });
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(pluginRoot, targetPath, { recursive: true, filter: shouldCopy });
}

const targetManifest = readJson(targetManifestPath);
if (targetManifest.name !== pluginName) {
  throw new Error(`Synced plugin name mismatch: expected ${pluginName}, got ${targetManifest.name}`);
}
if (targetManifest.version !== pluginVersion) {
  throw new Error(`Synced plugin version mismatch: expected ${pluginVersion}, got ${targetManifest.version}`);
}

console.log(`Verified ${targetManifest.name}@${targetManifest.version} in ${targetDisplay}`);

if (options.commit || options.push) {
  git(['add', relative(marketplaceDir, targetPath)], marketplaceDir);

  const hasStagedChanges = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: marketplaceDir }).status !== 0;
  if (hasStagedChanges) {
    git(['commit', '-m', `Sync ${pluginName} ${pluginVersion} to GxFn marketplace`], marketplaceDir);
  } else {
    console.log('No marketplace changes to commit.');
  }
}

if (options.push) {
  git(['push'], marketplaceDir);
}

function readArg(name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  if (index >= 0) {
    return args[index + 1];
  }

  return undefined;
}

function detectPluginRoot(candidateRoot) {
  if (existsSync(join(candidateRoot, '.codex-plugin', 'plugin.json'))) {
    return candidateRoot;
  }

  const pluginsDir = join(candidateRoot, 'plugins');
  if (!existsSync(pluginsDir)) {
    throw new Error(`Could not find .codex-plugin/plugin.json under ${candidateRoot}`);
  }

  const candidates = readdirSync(pluginsDir)
    .map((name) => join(pluginsDir, name))
    .filter((path) => existsSync(join(path, '.codex-plugin', 'plugin.json')));

  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one plugin root under ${pluginsDir}, found ${candidates.length}`);
  }

  return candidates[0];
}

function readJson(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing JSON file: ${path}`);
  }

  return JSON.parse(readFileSync(path, 'utf8'));
}

function shouldCopy(sourcePath) {
  const relativePath = relative(pluginRoot, sourcePath);
  const name = relativePath.split('/').pop();

  if (name === '.git' || name === 'node_modules' || name === '.DS_Store') {
    return false;
  }

  if (
    relativePath === '.codex-marketplace-install.json' ||
    relativePath === '.codex-marketplace-syncignore' ||
    relativePath === 'docs-dev' ||
    isIgnoredBySyncFile(relativePath)
  ) {
    return false;
  }

  if (existsSync(sourcePath) && statSync(sourcePath).isDirectory() && relativePath.endsWith('/node_modules')) {
    return false;
  }

  return true;
}

function readSyncIgnore(root) {
  const ignorePath = join(root, '.codex-marketplace-syncignore');
  if (!existsSync(ignorePath)) {
    return [];
  }

  return readFileSync(ignorePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.replace(/^\/+/, '').replace(/\/+$/, ''));
}

function isIgnoredBySyncFile(relativePath) {
  return ignoredRelativePaths.some((ignoredPath) => {
    return relativePath === ignoredPath || relativePath.startsWith(`${ignoredPath}/`);
  });
}

function git(gitArgs, cwd) {
  const result = spawnSync('git', gitArgs, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`git ${gitArgs.join(' ')} failed with status ${result.status}`);
  }
}
