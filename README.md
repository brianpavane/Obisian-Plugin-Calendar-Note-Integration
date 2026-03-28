# Google Calendar Note Integration

An [Obsidian](https://obsidian.md) plugin that creates structured meeting notes from your Google Calendar events.

Notes are pre-populated with the event's existing agenda/description and include ready-to-use sections for **Agenda**, **Notes**, **Summary**, and **Actions** — all formatted as bullet lists. Notes are created automatically in advance of your meetings, keeping your vault in sync with your calendar.

> **Desktop only.** This plugin requires Obsidian's desktop app (uses Electron APIs for the OAuth browser flow).

---

## Table of Contents

1. [Features](#features)
2. [Example Note](#example-note)
3. [Setup](#setup)
4. [Usage](#usage)
5. [Configuration Reference](#configuration-reference)
6. [Note Template Anatomy](#note-template-anatomy)
7. [Security Model](#security-model)
8. [Architecture](#architecture)
9. [Development](#development)
10. [Troubleshooting](#troubleshooting)

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

## Setup

### Step 1 — Create Google Cloud credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Navigate to **APIs & Services → Library** and enable the **Google Calendar API**.
3. Go to **APIs & Services → Credentials** and click **Create Credentials → OAuth 2.0 Client ID**.
4. Choose **Desktop app** as the application type and give it a name (e.g. "Obsidian Plugin").
5. Note the **Client ID** and **Client Secret** shown on the credential detail page.

> **Tip:** You may also need to configure the OAuth consent screen (choose "External" for personal use, then add your own email as a test user while the app is in "Testing" mode).

### Step 2 — Install the plugin

**From source** (until published to the Obsidian community plugins list):

```bash
# Build
npm install
npm run build

# Copy to your vault
cp main.js manifest.json styles.css \
  /path/to/vault/.obsidian/plugins/obsidian-google-calendar-notes/
```

Then enable the plugin in **Settings → Community Plugins**.

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
  title, date, calendar_event_id, location?, attendees?, conference_platform?

# Event Title

**Date:**      Long-form date  (e.g. Monday, March 30, 2026)
**Time:**      Time range       (e.g. 10:00 AM – 11:00 AM, or "All day")
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
| `styles.css` | Plugin CSS (settings tab, event picker suggestions) |
| `manifest.json` | Obsidian plugin manifest |
| `esbuild.config.mjs` | esbuild bundler configuration |
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

---

## License

MIT
