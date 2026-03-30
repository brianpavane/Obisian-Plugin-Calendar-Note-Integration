# Google Calendar Note Integration

An [Obsidian](https://obsidian.md) plugin that creates structured meeting notes from your Google Calendar events.

Notes are pre-populated with the event's existing agenda/description and include ready-to-use sections for **Agenda**, **Notes**, **Summary**, and **Actions** — all formatted as bullet lists. Notes are created automatically in advance of your meetings, keeping your vault in sync with your calendar.

> **Desktop only.** This plugin requires Obsidian's desktop app (uses Electron APIs for the OAuth browser flow).

[![GitHub release](https://img.shields.io/github/v/release/brianpavane/Obisian-Plugin-Calendar-Note-Integration)](https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Table of Contents

1. [Features](#features)
2. [Example Note](#example-note)
3. [Installation](#installation)
4. [Upgrading](#upgrading)
5. [Setup](#setup)
6. [Usage](#usage)
7. [Configuration Reference](#configuration-reference)
8. [Note Template Anatomy](#note-template-anatomy)
9. [Security Model](#security-model)
10. [Architecture](#architecture)
11. [Development](#development)
12. [Troubleshooting](#troubleshooting)

---

## Features

| Feature | Details |
|---|---|
| **Auto-create notes** | Notes are created automatically N hours before each event (default: 12 h) |
| **Startup sweep** | On launch, notes are created for any events already within the advance window |
| **Background polling** | Checks every 30 minutes (configurable) for events that need a note |
| **Event picker** | Fuzzy-search across upcoming events to create a note on demand |
| **Agenda from invite** | The event's description/notes are parsed and placed in the Agenda section |
| **Attendee RSVP table** | Attendees shown with name, email, and color-coded accept/decline status |
| **Conference links** | Video meeting links (Google Meet, Zoom, etc.) validated and included |
| **YAML frontmatter** | Structured metadata for use with Dataview or other plugins |
| **Idempotent** | Re-running never overwrites a note you've already started editing |

---

## Example Note

```markdown
---
title: "Q2 Planning Kickoff"
date: 2026-03-30
calendar_event_id: "abc123xyz"
location: "Conference Room B"
attendees:
  - "Alice Smith <alice@example.com>"
  - "Bob Jones <bob@example.com>"
  - "Carol White <carol@example.com>"
conference_platform: "Google Meet"
---

# Q2 Planning Kickoff

**Date:** Monday, March 30, 2026
**Time:** 10:00 AM – 11:00 AM
**Duration:** 1h
**Location:** Conference Room B
**Google Meet:** [Join meeting](https://meet.google.com/xxx-yyy-zzz)
**Organizer:** Alice Smith

**Attendees:**

|   | Name | Email |
|:-:|:-----|:------|
| 🔷 | Alice Smith *(organizer)* | alice@example.com |
| 🟢 | Bob Jones | bob@example.com |
| 🔴 | Carol White | carol@example.com |
| 🟡 | Dan Brown | dan@example.com |
| ⚪ | Eve Miller | eve@example.com |

---

## Agenda

- Review Q1 results and key learnings
- Discuss Q2 OKRs and priorities
- Assign owners for each initiative
-

## Notes

-

## Summary

-

## Actions

-
```

**RSVP icon legend:**

| Icon | Status |
|:----:|--------|
| 🟢 | Accepted |
| 🔴 | Declined |
| 🟡 | Tentative |
| ⚪ | Awaiting response |
| 🔷 | Organizer |

---

## Installation

There are three ways to install the plugin, in order of ease.

### Option A — BRAT (recommended for beta users)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) (Beta Reviewers Auto-update Tool) lets you install and auto-update plugins directly from GitHub without manual file management.

1. Install and enable the **Obsidian42 - BRAT** plugin from the Obsidian Community Plugins list.
2. Open **Settings → BRAT → Add Beta plugin**.
3. Enter the repository URL:
   ```
   https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration
   ```
4. Click **Add Plugin**. BRAT downloads the latest release automatically.
5. Enable **Google Calendar Note Integration** in **Settings → Community Plugins**.

BRAT can also auto-update the plugin when a new release is published — enable **Auto-update plugins at startup** in BRAT settings.

---

### Option B — Manual installation from a GitHub release

1. Go to the [Releases page](https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration/releases) and download the **latest release assets**:
   - `main.js`
   - `manifest.json`
   - `styles.css`

2. In your vault, create the plugin folder if it doesn't exist:
   ```
   <vault>/.obsidian/plugins/obsidian-google-calendar-notes/
   ```

3. Copy the three downloaded files into that folder.

4. In Obsidian, open **Settings → Community Plugins**, click the refresh icon, then enable **Google Calendar Note Integration**.

> **Tip:** You can find your vault folder by opening **Settings → About → Open vault folder** in Obsidian.

---

### Option C — Build from source

Use this approach if you want the latest unreleased code, or if you are contributing to the plugin.

**Prerequisites:** Node.js 18+ and npm.

```bash
# 1. Clone the repository
git clone https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration.git
cd Obisian-Plugin-Calendar-Note-Integration

# 2. Install dependencies
npm install

# 3. Build the production bundle
npm run build

# 4. Copy the build output into your vault
cp main.js manifest.json styles.css \
  "/path/to/your/vault/.obsidian/plugins/obsidian-google-calendar-notes/"
```

5. Enable the plugin in **Settings → Community Plugins**.

---

## Upgrading

### Upgrading with BRAT

If you installed via BRAT, run **Settings → BRAT → Check for updates** (or enable auto-update) — BRAT handles everything.

### Upgrading a manual installation

1. Go to the [Releases page](https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration/releases) and download the latest release assets:
   - `main.js`
   - `manifest.json`
   - `styles.css`

2. Copy and overwrite the existing files in your vault's plugin folder:
   ```
   <vault>/.obsidian/plugins/obsidian-google-calendar-notes/
   ```

3. Reload the plugin: **Settings → Community Plugins → Disable**, then **Enable** again (or restart Obsidian).

> **Your `data.json` is preserved** — settings and tokens are never overwritten by an upgrade.

> **Token re-encryption:** Version 1.1.0 introduced at-rest encryption for OAuth tokens. On the first launch after upgrading from 1.0.0, tokens are read as legacy plaintext and automatically re-encrypted when settings are next saved. No manual action is required.

### Upgrading a source build

```bash
# Pull the latest changes
git pull origin main

# Re-build
npm run build

# Copy updated files to your vault
cp main.js manifest.json styles.css \
  "/path/to/your/vault/.obsidian/plugins/obsidian-google-calendar-notes/"
```

Then reload the plugin in Obsidian as described above.

---

## Setup

### Step 1 — Create Google Cloud credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Navigate to **APIs & Services → Library** and enable the **Google Calendar API**.
3. Go to **APIs & Services → Credentials** and click **Create Credentials → OAuth 2.0 Client ID**.
4. Choose **Desktop app** as the application type and give it a name (e.g. "Obsidian Plugin").
5. Note the **Client ID** and **Client Secret** shown on the credential detail page.

> **Tip:** You may also need to configure the OAuth consent screen (choose "External" for personal use, then add your own email as a test user while the app is in "Testing" mode).

### Step 2 — Install the plugin

See the [Installation](#installation) section above for all install methods (BRAT, manual release download, or source build).

### Step 3 — Authenticate

1. Open **Settings → Google Calendar Note Integration**.
2. Paste your **Client ID** and **Client Secret**.
3. Click **Authenticate** — your default browser opens a Google sign-in page.
4. Sign in and grant the requested **read-only** calendar access.
5. The browser shows "Authorization Successful" and returns control to Obsidian.

Authentication is a one-time step. The plugin stores a refresh token and automatically renews the access token in the background.

---

## Usage

### Automatic (recommended)

Once authenticated, the plugin runs quietly in the background:

- **On startup:** Checks for any events starting within the next 12 hours (configurable) and creates notes for them.
- **Every 30 minutes:** Re-checks for new events entering the advance window.
- Notes are created silently; a brief notice appears only when new notes are made.

### Manual — Command Palette

| Command | Description |
|---|---|
| `Create note from Google Calendar event` | Open the fuzzy-search event picker |
| `Create note for next upcoming event` | Instantly create a note for the very next event |
| `Auto-create notes for events in the next N hours` | Manual sweep with a result summary |

### Manual — Ribbon Icon

Click the **calendar** icon (📅) in the left ribbon to open the event picker.

### Event Picker

The picker uses Obsidian's built-in fuzzy search. Type any part of an event title or date to filter. Each result shows:

- Event title
- Date and time
- Attendee count (if any)
- **"has agenda"** badge when the invite has a description
- **"video"** badge when a conference link is present

---

## Configuration Reference

All settings are in **Settings → Google Calendar Note Integration**.

### Google API Credentials

| Setting | Description |
|---|---|
| **Client ID** | OAuth 2.0 Client ID from Google Cloud Console |
| **Client Secret** | OAuth 2.0 Client Secret (stored securely in plugin data) |
| **Authenticate** | Opens the browser OAuth flow |
| **Disconnect** | Removes stored tokens (requires re-authentication) |

### Calendar Settings

| Setting | Default | Range | Description |
|---|---|---|---|
| **Calendar ID** | `primary` | — | Calendar to fetch. `"primary"` = default calendar |
| **Days ahead to fetch** | `7` | 1–30 days | Look-ahead window for the event picker |
| **Max events to show** | `20` | 1–50 | Max events shown in the picker |

### Note Settings

| Setting | Default | Range | Description |
|---|---|---|---|
| **Note folder** | `Meeting Notes` | any path | Vault-relative folder for new notes. Empty = vault root |
| **Hours in advance** | `12` | 1–48 h | How far before an event to auto-create its note |
| **Poll interval** | `30` | 5–120 min | How often to check for new events needing a note |

> **Note:** Changing the poll interval takes effect after the next Obsidian restart.

---

## Note Template Anatomy

Every generated note has the following structure:

```
YAML Frontmatter
  title, date, calendar_event_id, location?, attendees?, duration?, conference_platform?

# Event Title

**Date:**      Long-form date  (e.g. Monday, March 30, 2026)
**Time:**      Time range       (e.g. 10:00 AM – 11:00 AM, or "All day")
**Duration:**  Length of meeting (e.g. 1h 30m — timed events only)
**Location:**  Physical location (if present in the event)
**<Platform>:** [Join meeting](<url>)  (if a video link is present)
**Organizer:** Name / email    (if present)

**Attendees:**
| 🟢/🔴/🟡/⚪/🔷 | Name | Email |
(one row per attendee, excluding your own entry)

---

## Agenda
  (bullet list pre-populated from the event description, or empty)

## Notes
  (empty bullet list for live notes)

## Summary
  (empty bullet list for post-meeting summary)

## Actions
  (empty bullet list for action items / follow-ups)
```

### Filename format

```
YYYY-MM-DD Event Title.md
```

Example: `2026-03-30 Q2 Planning Kickoff.md`

Characters forbidden by common file systems (`\ / : * ? " < > |`) are replaced with hyphens.

---

## Security Model

This section documents all security decisions made in the plugin.

### OAuth 2.0 flow

- Uses the **installed app** flow (not a web server flow) — the redirect URI is `http://127.0.0.1:42813`, bound to localhost only.
- A **cryptographically random `state` token** (`crypto.randomUUID()`) is generated for each auth attempt and verified when Google redirects back, preventing CSRF attacks.
- The local HTTP server is shut down immediately after receiving the first valid redirect.
- A **5-minute timeout** aborts the flow if the user does not complete it.

### Token storage

- The access token and refresh token are stored in plaintext in `.obsidian/plugins/obsidian-google-calendar-notes/data.json`.
- This is consistent with Obsidian plugin conventions; the file is only readable by the local OS user.
- The plugin requests only the **`calendar.readonly`** scope — it cannot modify, create, or delete calendar events.

### Input sanitization

All data received from the Google Calendar API (event titles, descriptions, attendee names, locations, etc.) is treated as untrusted and sanitized before use:

| Context | Threat | Mitigation |
|---|---|---|
| YAML frontmatter values | YAML injection via embedded newlines | `escapeYaml()` escapes `\n`, `\r`, `\t`, `"`, `\` |
| Markdown headings and bold fields | Newlines breaking Markdown structure | `sanitizeInline()` collapses newlines to spaces |
| Markdown table cells | `\|` pipe chars breaking table rows | `escapeMdCell()` escapes pipes and newlines |
| Conference link URIs | `javascript:` / `data:` URI injection | `isSafeHttpsUrl()` only allows `https:` and `http:` |
| OAuth redirect page HTML | XSS from Google's `error` query param | `escapeHtml()` applied before reflecting into HTML |

### Network requests

- All `fetch()` calls have a **10-second `AbortController` timeout**.
- All requests are made to Google APIs over HTTPS only.
- Token endpoint responses are validated: missing or non-string `access_token` values throw an error rather than being silently stored.

---

## Architecture

```
src/
├── main.ts          Plugin entry point — registers commands, ribbon, polling
├── settings.ts      Settings interface, defaults, and settings tab UI
├── googleAuth.ts    OAuth 2.0 flow (authorize, refresh, token parsing)
├── calendarApi.ts   Google Calendar REST API v3 client
├── noteCreator.ts   Note content builder + vault file management
└── eventModal.ts    Fuzzy-search event picker modal
```

### Data flow

```
Google Calendar API
        │
        ▼  (calendarApi.ts)
 CalendarEvent objects
        │
        ▼  (noteCreator.ts)
 Markdown note content   ──► Obsidian vault file
        │
        ▼  (eventModal.ts)
 User selection (optional)
```

### Token refresh

```
plugin load / API call
        │
        ├─ tokenExpiry > now + 60s? ──► use stored accessToken
        │
        └─ expired / near-expiry
                │
                ▼  (googleAuth.ts · refreshAccessToken)
         POST /token (refresh_token grant)
                │
                ▼
         new accessToken + expiry_date  ──► persist to settings
```

---

## Development

### Prerequisites

- Node.js 18+
- An Obsidian vault for testing

### Commands

```bash
# Install dependencies
npm install

# Development build (watch mode — rebuilds on file changes)
npm run dev

# Production build (minified, no source maps)
npm run build
```

### Versioning

The plugin uses [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).
**Bump the version before every release** using the helper scripts — they update `manifest.json`, `package.json`, and `versions.json` in one step:

```bash
# Patch bump: bug fixes, no new features  →  e.g. 1.1.0 → 1.1.1
npm run version:patch

# Minor bump: new features, backwards-compatible  →  e.g. 1.1.0 → 1.2.0
npm run version:minor

# Major bump: breaking changes  →  e.g. 1.1.0 → 2.0.0
npm run version:major
```

After bumping, update `CHANGELOG.md` with a summary of changes, then build, commit, and create a GitHub Release:

```bash
npm run build
git add manifest.json versions.json package.json CHANGELOG.md main.js
git commit -m "Release X.Y.Z"
git tag X.Y.Z
git push origin main --tags
```

> **No `v` prefix on tags.** Obsidian's release validator requires the tag to be bare semver (e.g. `1.1.0`, not `v1.1.0`). The tag must exactly match the `version` field in `manifest.json`.

Then go to [github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration/releases/new](https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration/releases/new), select the tag you just pushed, and attach `main.js`, `manifest.json`, and `styles.css` as release assets. This is required for:
- The release badge in the README to update.
- BRAT to detect and offer the upgrade to users.
- Manual installers to download the built files without building from source.

### Installing the dev build

Copy the build output into your vault's plugin folder:

```bash
cp main.js manifest.json styles.css \
  /path/to/vault/.obsidian/plugins/obsidian-google-calendar-notes/
```

Then use **Settings → Community Plugins → Reload plugins** (or restart Obsidian).

### Project structure

| File | Purpose |
|---|---|
| `src/main.ts` | Plugin lifecycle, commands, token management, polling |
| `src/settings.ts` | `GoogleCalendarSettings` interface and settings tab |
| `src/googleAuth.ts` | OAuth 2.0 authorize + refresh flows |
| `src/calendarApi.ts` | Google Calendar API v3 client |
| `src/noteCreator.ts` | Markdown note builder + vault file writer |
| `src/eventModal.ts` | `FuzzySuggestModal` for the event picker |
| `src/secureStorage.ts` | Electron `safeStorage` wrapper for at-rest encryption |
| `styles.css` | Plugin CSS (settings tab, event picker suggestions) |
| `manifest.json` | Obsidian plugin manifest |
| `versions.json` | Maps plugin versions → minimum Obsidian app versions |
| `CHANGELOG.md` | Release history |
| `esbuild.config.mjs` | esbuild bundler configuration |
| `version-bump.mjs` | Version bump script (updates manifest, package, versions) |
| `tsconfig.json` | TypeScript compiler configuration |
| `versions.json` | Maps plugin versions to minimum Obsidian versions |

---

## Troubleshooting

### "Please configure your API credentials"

Enter your Google Cloud Console **Client ID** and **Client Secret** in Settings and click **Authenticate**.

### "Failed to start local auth server on port 42813"

Another application is using port 42813. Temporarily stop it, then try authenticating again.

### "Authorization timed out after 5 minutes"

The browser OAuth flow was not completed within 5 minutes. Click **Authenticate** again.

### "OAuth state mismatch"

A stale or duplicate redirect was received. Click **Authenticate** again to start a fresh flow.

### "Google Calendar API error: …"

The access token may have been revoked. Go to Settings and click **Re-authenticate**.

### Notes are not being created automatically

1. Confirm the plugin is authenticated (Settings shows "✓ Authenticated with Google").
2. Check that **Hours in advance** is set high enough to cover upcoming events.
3. Use the **"Auto-create notes for events in the next N hours"** command to trigger a manual sweep with verbose output.

### The note folder is not being created

Ensure **Note folder** in Settings contains only valid folder characters. Leave it empty to use the vault root.

---

## Privacy

This plugin communicates **only** with Google's Calendar API using your own OAuth credentials. No data is sent to any third-party server. Tokens are stored locally in Obsidian's plugin data file and are never transmitted anywhere other than `oauth2.googleapis.com` and `www.googleapis.com`.

### Vault access and credential security

- **OAuth tokens are encrypted at rest** using Electron's `safeStorage` API, which delegates to the OS credential store (macOS Keychain, Windows DPAPI, Linux Secret Service / kwallet). Tokens are stored as opaque encrypted blobs in `data.json`; they cannot be read by another OS user or process without your user account credentials.
- **Encrypted tokens are machine-bound.** If you move your vault to a different machine or OS user account, stored tokens will fail to decrypt and the plugin will prompt you to re-authenticate. No data is lost — only the tokens need to be refreshed.
- **Vault folder access control.** Meeting notes (including any agenda text copied from your calendar invites) are written to the configured note folder inside your vault. Ensure your vault directory is not shared with untrusted users or synced to a public location, as calendar details will appear in plain text in the generated `.md` files.
- **On Linux without a keyring daemon** (e.g., `gnome-keyring` or `kwallet`), `safeStorage` may fall back to a basic cipher. A warning is printed to the developer console in this case. Running a keyring daemon is recommended for full protection.

---

## License

MIT
