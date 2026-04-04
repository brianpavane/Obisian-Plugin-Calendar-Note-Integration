# Calendar Note Integration — Claude Instructions

## Project Overview

Obsidian plugin that creates structured notes from Apple Calendar, Google Calendar (iCal/OAuth), or any iCal feed. Written in TypeScript, built with esbuild, tested with a Node-based test runner in `scripts/run-tests.mjs`.

**Key files:**
- `src/` — TypeScript source
- `main.js` — compiled output (committed to repo for Obsidian)
- `manifest.json` — plugin metadata including version
- `versions.json` — maps plugin version → minimum Obsidian app version
- `version-bump.mjs` — bumps version across manifest.json, package.json, versions.json
- `CHANGELOG.md` — Keep a Changelog format, newest entry at top
- `tests/` — test files consumed by `scripts/run-tests.mjs`

---

## Commit Checklist — Required on Every Commit

Before creating any git commit, you MUST complete ALL of the following steps in order:

### 1. Run the Full Test Suite

```bash
npm test
```

All tests must pass. If any test fails, fix the failure before proceeding. Do not commit broken code.

### 2. Bump the Patch Version

```bash
node version-bump.mjs patch
git add manifest.json versions.json package.json
```

This updates the version in `manifest.json`, `package.json`, and `versions.json`. Always use `patch` for routine commits. Use `minor` for new features, `major` for breaking changes.

### 3. Update CHANGELOG.md

Add a new entry at the top of `CHANGELOG.md` (below the header, above the previous release). Follow the existing format exactly:

```markdown
## [X.Y.Z] – YYYY-MM-DD

### Fixed / Added / Changed / Removed

**Short title for the change**
One or two sentences describing what changed and why it matters to users.
```

Rules:
- Use today's date.
- Use the new version from step 2.
- Group changes under the correct heading(s): `Fixed`, `Added`, `Changed`, `Removed`.
- Write each item as a **bolded title** followed by a plain-English description.
- Be specific — describe behaviour change, not implementation detail.

### 4. Update README.md (when behaviour changes)

If the commit changes user-facing behaviour, settings, commands, or UI:
- Update the relevant section(s) in `README.md`.
- Keep the existing structure and formatting.
- Do not add placeholder sections or TODOs.

### 5. Stage and Commit

```bash
git add -p   # or add specific files
git commit -m "type: concise present-tense summary"
```

Commit message format: `type: summary` where type is `fix`, `feat`, `refactor`, `test`, `docs`, or `chore`.

---

## Version Bump Level Guide

| Change type | Level | Example |
|---|---|---|
| Bug fix, minor improvement | `patch` | 6.5.3 → 6.5.4 |
| New feature, new setting, new UI | `minor` | 6.5.3 → 6.6.0 |
| Breaking change, major rewrite | `major` | 6.5.3 → 7.0.0 |

---

## Code Conventions

- TypeScript strict mode — no implicit `any`.
- No mocking of the filesystem in tests; use in-memory vault helpers already established in the test suite.
- `npm run build` must succeed (TypeScript compile + esbuild) before committing `main.js`.
- Do not add comments unless the logic is genuinely non-obvious.
- Do not add error handling for cases that cannot happen.

---

## Test Runner

```bash
npm test          # run all tests
```

Tests live in `tests/`. The runner is `scripts/run-tests.mjs`. It is Node-based — no Jest, no Mocha. Add new test files as `.mjs` modules that export a default async function.
