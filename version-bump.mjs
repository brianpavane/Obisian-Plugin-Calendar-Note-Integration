/**
 * version-bump.mjs
 *
 * Bumps the plugin version across manifest.json, package.json, and
 * versions.json, then stages those files for the commit.
 *
 * Usage (via npm scripts):
 *   npm run version:patch   →  1.0.0 → 1.0.1
 *   npm run version:minor   →  1.0.1 → 1.1.0
 *   npm run version:major   →  1.1.0 → 2.0.0
 *
 * Called automatically by `npm version <level>` because package.json's
 * "version" script runs this file before git stages the version commit.
 *
 * The script also accepts a literal version as the first argument:
 *   node version-bump.mjs 1.2.0
 */

import { readFileSync, writeFileSync } from "fs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, "\t") + "\n", "utf8");
}

function bumpVersion(current, level) {
  const [major, minor, patch] = current.split(".").map(Number);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  if (level === "patch") return `${major}.${minor}.${patch + 1}`;
  // Literal version string
  if (/^\d+\.\d+\.\d+$/.test(level)) return level;
  throw new Error(`Unknown bump level: "${level}". Use major, minor, patch, or a semver string.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const level = process.argv[2] ?? "patch";

const manifest = readJson("manifest.json");
const pkg      = readJson("package.json");
const versions = readJson("versions.json");

const oldVersion = manifest.version;
const newVersion = bumpVersion(oldVersion, level);

if (newVersion === oldVersion) {
  console.log(`Version is already ${oldVersion}. Nothing to do.`);
  process.exit(0);
}

manifest.version = newVersion;
pkg.version      = newVersion;

// versions.json maps plugin version → minimum Obsidian app version.
// Preserve the existing minAppVersion for this release.
const minAppVersion = manifest.minAppVersion;
versions[newVersion] = minAppVersion;

writeJson("manifest.json", manifest);
writeJson("package.json",  pkg);
writeJson("versions.json", versions);

console.log(`Bumped ${oldVersion} → ${newVersion}`);
