# Release Process

Step-by-step copy/paste instructions for pulling, tagging, and publishing every release of **Calendar Note Integration - Apple-iCal-Google**.

---

## 1. Pull the latest changes

Always start from an up-to-date local copy of `main`.

```bash
git checkout main
git pull origin main
```

---

## 2. Verify the build is clean

```bash
npm run build
```

The command must exit without errors before proceeding. Fix any TypeScript or build errors first.

---

## 3. Confirm the version numbers are consistent

All four files must show the same version string:

```bash
grep '"version"' manifest.json package.json
cat versions.json
```

Expected output (substitute the actual version):

```
manifest.json:  "version": "6.5.2",
package.json:   "version": "6.5.2",
{
    ...
    "6.5.2": "0.15.0"
}
```

If any file is out of sync, update it manually before continuing.

---

## 4. Create and push the annotated git tag

Replace `6.5.2` with the actual version. The tag name must match the version in `manifest.json` exactly (no `v` prefix).

```bash
git tag -a 6.5.2 -m "Release 6.5.2"
git push origin 6.5.2
```

Verify the tag was pushed:

```bash
git ls-remote --tags origin
```

---

## 5. Create the GitHub release

Go to the repository on GitHub:

```
https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration/releases/new
```

Fill in the form:

| Field | Value |
|---|---|
| **Tag** | Choose the tag you just pushed (e.g. `6.5.2`) |
| **Release title** | `6.5.2` |
| **Description** | Paste the relevant section from `CHANGELOG.md` (see below) |
| **Attach files** | Drag in `main.js`, `manifest.json`, and `styles.css` (if present) |
| **Pre-release** | Leave unchecked unless this is a beta |

Click **Publish release**.

---

## 6. Copy the release notes from CHANGELOG.md

Open `CHANGELOG.md` and copy everything under the matching `## [X.Y.Z]` heading down to (but not including) the next `---` divider. Paste it into the GitHub release description field.

---

## Full end-to-end command sequence (copy as a block)

Replace every occurrence of `6.5.2` with the real version before running.

```bash
# 1. Pull latest
git checkout main
git pull origin main

# 2. Build
npm run build

# 3. Sanity-check versions
grep '"version"' manifest.json package.json
cat versions.json

# 4. Tag and push
git tag -a 6.5.2 -m "Release 6.5.2"
git push origin 6.5.2
```

Then complete step 5 (GitHub release) in the browser.

---

## When to bump the version

| Change type | Part to bump | Example |
|---|---|---|
| Bug fix, patch improvement | **patch** (Z) | 6.5.1 → 6.5.2 |
| New feature, backwards-compatible | **minor** (Y) | 6.5.2 → 6.6.0 |
| Breaking change, major rework | **major** (X) | 6.6.0 → 7.0.0 |

Files to update on every version bump:

1. `manifest.json` — `"version"` field
2. `package.json` — `"version"` field
3. `versions.json` — add `"X.Y.Z": "0.15.0"` entry
4. `CHANGELOG.md` — add `## [X.Y.Z] – YYYY-MM-DD` section at the top
5. Run `npm run build` to bake the new version + build date into `main.js`
6. Commit: `git commit -m "chore: bump version to X.Y.Z"`
7. Push: `git push origin main`
8. Follow steps 4–6 above to tag and release

---

## Commit message conventions

| Prefix | Use for |
|---|---|
| `feat:` | New user-facing feature |
| `fix:` | Bug fix |
| `perf:` | Performance improvement |
| `chore:` | Version bumps, dependency updates, tooling |
| `docs:` | Documentation only |
| `refactor:` | Code change with no behaviour change |

Examples:
```
feat: v6.5.1 — version label, Refresh/Rebuild split, processedEventIds tracking
fix: prevent polling from recreating manually deleted notes
chore: bump version to 6.5.2
```

---

## Release artefacts checklist

Before publishing the GitHub release, confirm these three files are attached:

- `main.js` — the compiled plugin bundle (built by `npm run build`)
- `manifest.json` — plugin metadata (id, name, version, minAppVersion)
- `styles.css` — stylesheet (include even if empty; required by the Obsidian community plugin validator)
