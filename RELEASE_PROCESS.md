# Release Process

**Repository: `brianpavane/Obisian-Plugin-Calendar-Note-Integration`**

> The version is bumped as part of the normal commit workflow (see `CLAUDE.md`),
> so by release time `manifest.json` already holds the version to ship. All
> commands below read it into a single `VERSION` variable — this file never
> needs editing per release.

---

## Step 1 — Read the version

```bash
VERSION=$(node -p "require('./manifest.json').version")
echo $VERSION
```

Run this in your terminal first. Every subsequent block uses `$VERSION`.

---

## Step 2 — Pull latest main

```bash
git checkout main
git pull origin main
```

---

## Step 3 — Verify versions are consistent

```bash
grep '"version"' manifest.json package.json
cat versions.json
```

All three must show `$VERSION`. If any are out of sync, update them before continuing:

| File | Field | Expected value |
|---|---|---|
| `manifest.json` | `"version"` | `$VERSION` |
| `package.json` | `"version"` | `$VERSION` |
| `versions.json` | new entry | `"$VERSION": "<minAppVersion from manifest.json>"` |

---

## Step 4 — Build

```bash
npm run build
```

Must complete with no errors. The build date is injected automatically into `main.js`.

---

## Step 5 — Push main

The version bump and changelog entry are already committed by the commit workflow.

```bash
git status          # must be clean
git push origin main
```

---

## Step 6 — Create and push the annotated tag

```bash
git tag -a $VERSION -m "Release $VERSION"
git push origin $VERSION
```

Verify the tag is on the remote:

```bash
git ls-remote --tags origin | grep $VERSION
```

---

## Step 7 — Create the GitHub release

```bash
gh release create $VERSION \
  main.js manifest.json styles.css \
  --repo brianpavane/Obisian-Plugin-Calendar-Note-Integration \
  --title "$VERSION" \
  --notes "$(awk "/^## \[$VERSION\]/{found=1; next} found && /^---/{exit} found{print}" CHANGELOG.md)" \
  --latest
```

> `gh` extracts the matching section from `CHANGELOG.md` automatically.

---

## Step 8 — Confirm the release

```bash
gh release view $VERSION --repo brianpavane/Obisian-Plugin-Calendar-Note-Integration
```

---

## Full sequence — copy entire block, set VERSION, paste

```bash
# ── READ VERSION ─────────────────────────────────────────────────────────────
VERSION=$(node -p "require('./manifest.json').version")

# ── PULL & BUILD ─────────────────────────────────────────────────────────────
git checkout main
git pull origin main
npm run build

# ── VERIFY VERSIONS ──────────────────────────────────────────────────────────
grep '"version"' manifest.json package.json
cat versions.json

# ── PUSH ─────────────────────────────────────────────────────────────────────
git status
git push origin main

# ── TAG ──────────────────────────────────────────────────────────────────────
git tag -a $VERSION -m "Release $VERSION"
git push origin $VERSION

# ── GITHUB RELEASE ───────────────────────────────────────────────────────────
gh release create $VERSION \
  main.js manifest.json styles.css \
  --repo brianpavane/Obisian-Plugin-Calendar-Note-Integration \
  --title "$VERSION" \
  --notes "$(awk "/^## \[$VERSION\]/{found=1; next} found && /^---/{exit} found{print}" CHANGELOG.md)" \
  --latest

# ── CONFIRM ──────────────────────────────────────────────────────────────────
gh release view $VERSION --repo brianpavane/Obisian-Plugin-Calendar-Note-Integration
```

---

## Pre-release (beta) variant

Add `--prerelease` and use a version like `6.6.0-beta.1`:

```bash
VERSION=6.6.0-beta.1

gh release create $VERSION \
  main.js manifest.json styles.css \
  --repo brianpavane/Obisian-Plugin-Calendar-Note-Integration \
  --title "$VERSION (beta)" \
  --notes "Beta release — not recommended for production use." \
  --prerelease
```

---

## Managing releases

```bash
# List all releases
gh release list --repo brianpavane/Obisian-Plugin-Calendar-Note-Integration

# Delete a release (keeps the tag)
gh release delete $VERSION --repo brianpavane/Obisian-Plugin-Calendar-Note-Integration

# Delete a tag locally and remotely
git tag -d $VERSION
git push origin --delete $VERSION

# Edit release notes after publishing
gh release edit $VERSION \
  --repo brianpavane/Obisian-Plugin-Calendar-Note-Integration \
  --notes "Updated notes here"

# Upload an additional file to an existing release
gh release upload $VERSION styles.css \
  --repo brianpavane/Obisian-Plugin-Calendar-Note-Integration
```

---

## Version bump rules

| Change type | Bump | Example |
|---|---|---|
| Bug fix, minor improvement | **patch** (Z) | 6.5.3 → 6.5.4 |
| New feature, backwards-compatible | **minor** (Y) | 6.5.3 → 6.6.0 |
| Breaking change, major rework | **major** (X) | 6.6.0 → 7.0.0 |

Files updated on every bump (`node version-bump.mjs <level>` handles the first three):

1. `manifest.json` — `"version"`
2. `package.json` — `"version"`
3. `versions.json` — adds `"X.Y.Z": "<minAppVersion>"` entry
4. `CHANGELOG.md` — add `## [X.Y.Z] – YYYY-MM-DD` section at top (manual)

---

## Commit message conventions

| Prefix | Use for |
|---|---|
| `feat:` | New user-facing feature |
| `fix:` | Bug fix |
| `perf:` | Performance improvement |
| `chore:` | Version bumps, dependency updates, tooling |
| `docs:` | Documentation only |
| `refactor:` | Internal code change, no behaviour change |

---

## Release artefact checklist

| File | Required | Notes |
|---|---|---|
| `main.js` | Yes | Compiled plugin — produced by `npm run build` |
| `manifest.json` | Yes | Plugin metadata (id, name, version, minAppVersion) |
| `styles.css` | Yes | Event picker styling — attach to every release |
