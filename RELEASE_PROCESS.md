# Release Process

**Current released version: `6.5.5`**
**Repository: `brianpavane/Obisian-Plugin-Calendar-Note-Integration`**

> This file is updated on every release. All commands below use a single `VERSION`
> variable — set it once at the top and paste the remaining blocks as-is.

---

## Step 1 — Set the version (change this line only)

```bash
VERSION=6.5.5
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
| `manifest.json` | `"version"` | `6.5.5` |
| `package.json` | `"version"` | `6.5.5` |
| `versions.json` | new entry | `"6.5.5": "0.15.0"` |

---

## Step 4 — Build

```bash
npm run build
```

Must complete with no errors. The build date is injected automatically into `main.js`.

---

## Step 5 — Commit the version bump (if not already committed)

```bash
git add manifest.json package.json versions.json CHANGELOG.md RELEASE_PROCESS.md
git commit -m "chore: bump version to $VERSION"
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
  main.js manifest.json \
  --repo brianpavane/Obisian-Plugin-Calendar-Note-Integration \
  --title "$VERSION" \
  --notes "$(awk "/^## \[$VERSION\]/{found=1; next} found && /^---/{exit} found{print}" CHANGELOG.md)" \
  --latest
```

> `gh` extracts the matching section from `CHANGELOG.md` automatically.
> Attach `styles.css` too if it exists:
> ```bash
> gh release create $VERSION \
>   main.js manifest.json styles.css \
>   --repo brianpavane/Obisian-Plugin-Calendar-Note-Integration \
>   --title "$VERSION" \
>   --notes "$(awk "/^## \[$VERSION\]/{found=1; next} found && /^---/{exit} found{print}" CHANGELOG.md)" \
>   --latest
> ```

---

## Step 8 — Confirm the release

```bash
gh release view $VERSION --repo brianpavane/Obisian-Plugin-Calendar-Note-Integration
```

---

## Full sequence — copy entire block, set VERSION, paste

```bash
# ── SET VERSION ONCE ──────────────────────────────────────────────────────────
VERSION=6.5.5

# ── PULL & BUILD ─────────────────────────────────────────────────────────────
git checkout main
git pull origin main
npm run build

# ── VERIFY VERSIONS ──────────────────────────────────────────────────────────
grep '"version"' manifest.json package.json
cat versions.json

# ── COMMIT (if not already done) ─────────────────────────────────────────────
git add manifest.json package.json versions.json CHANGELOG.md RELEASE_PROCESS.md
git commit -m "chore: bump version to $VERSION"
git push origin main

# ── TAG ──────────────────────────────────────────────────────────────────────
git tag -a $VERSION -m "Release $VERSION"
git push origin $VERSION

# ── GITHUB RELEASE ───────────────────────────────────────────────────────────
gh release create $VERSION \
  main.js manifest.json \
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
  main.js manifest.json \
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

Files to update on every bump:

1. `manifest.json` — `"version"`
2. `package.json` — `"version"`
3. `versions.json` — add `"X.Y.Z": "0.15.0"` entry
4. `CHANGELOG.md` — add `## [X.Y.Z] – YYYY-MM-DD` section at top
5. `RELEASE_PROCESS.md` — update **Current released version** line at top and `VERSION=` in the full sequence block

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
| `styles.css` | Yes | Include even if empty — required by community plugin validator |
