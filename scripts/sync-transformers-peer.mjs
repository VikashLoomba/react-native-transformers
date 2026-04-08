#!/usr/bin/env node

import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageName = '@huggingface/transformers';
const rootPackageJsonPath = path.resolve(__dirname, '..', 'package.json');
const examplePackageJsonPath = path.resolve(__dirname, '..', 'example', 'package.json');
const versionPattern = /\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?/;
const shouldWrite = process.argv.includes('--write');

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function getPinnedVersion(specifier, label) {
  const match = String(specifier ?? '').match(versionPattern);

  if (!match) {
    throw new Error(`Could not find a pinned semver in ${label}: ${specifier}`);
  }

  return match[0];
}

function replacePinnedVersion(specifier, nextVersion) {
  if (!versionPattern.test(String(specifier ?? ''))) {
    throw new Error(`Could not replace pinned semver in specifier: ${specifier}`);
  }

  return String(specifier).replace(versionPattern, nextVersion);
}

async function fetchLatestVersion() {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch latest ${packageName} version: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (!payload?.version) {
    throw new Error(`npm registry response for ${packageName} did not include a version`);
  }

  return payload.version;
}

async function writeOutputs(outputs) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${String(value)}`);
  await appendFile(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

const rootPackageJson = await readJson(rootPackageJsonPath);
const examplePackageJson = await readJson(examplePackageJsonPath);

const currentRootSpecifier = rootPackageJson.peerDependencies?.[packageName];
const currentExampleSpecifier = examplePackageJson.dependencies?.[packageName];

if (!currentRootSpecifier) {
  throw new Error(`${rootPackageJsonPath} is missing peerDependencies.${packageName}`);
}

if (!currentExampleSpecifier) {
  throw new Error(`${examplePackageJsonPath} is missing dependencies.${packageName}`);
}

const currentRootVersion = getPinnedVersion(currentRootSpecifier, 'root peer dependency');
const currentExampleVersion = getPinnedVersion(currentExampleSpecifier, 'example dependency');
const latestVersion = await fetchLatestVersion();
const nextRootSpecifier = replacePinnedVersion(currentRootSpecifier, latestVersion);
const nextExampleSpecifier = replacePinnedVersion(currentExampleSpecifier, latestVersion);
const changed = currentRootVersion !== latestVersion || currentExampleVersion !== latestVersion;

if (shouldWrite && changed) {
  rootPackageJson.peerDependencies[packageName] = nextRootSpecifier;
  examplePackageJson.dependencies[packageName] = nextExampleSpecifier;

  await writeJson(rootPackageJsonPath, rootPackageJson);
  await writeJson(examplePackageJsonPath, examplePackageJson);
}

await writeOutputs({
  changed,
  latest_version: latestVersion,
  current_root_version: currentRootVersion,
  current_root_specifier: currentRootSpecifier,
  next_root_specifier: nextRootSpecifier,
  current_example_version: currentExampleVersion,
  current_example_specifier: currentExampleSpecifier,
  next_example_specifier: nextExampleSpecifier,
  write_applied: shouldWrite && changed,
});

const statusLine = changed
  ? `Out of sync: root ${currentRootSpecifier} -> ${nextRootSpecifier}; example ${currentExampleSpecifier} -> ${nextExampleSpecifier}`
  : `Already up to date with ${packageName} ${latestVersion}`;

console.log(statusLine);
console.log(
  JSON.stringify(
    {
      changed,
      latestVersion,
      currentRootSpecifier,
      nextRootSpecifier,
      currentExampleSpecifier,
      nextExampleSpecifier,
      writeApplied: shouldWrite && changed,
    },
    null,
    2,
  ),
);
