# Google Calendar Note Integration

An [Obsidian](https://obsidian.md) plugin that automatically creates structured meeting notes from your calendar events.

Notes are pre-populated with the event's agenda/description and include ready-to-use sections for **Agenda**, **Notes**, **Summary**, and **Actions**. Notes are created automatically in advance of your meetings, keeping your vault in sync with your calendar.

> **Desktop only.** This plugin requires the Obsidian desktop app (macOS, Windows, or Linux).

---

## Table of Contents

1. [Features](#features)
2. [Connection Methods](#connection-methods)
3. [Example Note](#example-note)
4. [Installation](#installation)
5. [Setup](#setup)
   - [iCal URL (personal calendars)](#option-a--ical-url-personal--public-calendars)
   - [Google Account (work/org calendars)](#option-b--google-account-workorg-calendars)
   - [Apple Calendar (macOS)](#option-c--apple-calendar-macos)
6. [Usage](#usage)
7. [Configuration Reference](#configuration-reference)
8. [Note Template Anatomy](#note-template-anatomy)
9. [Security Model](#security-model)
10. [Development](#development)
11. [Troubleshooting](#troubleshooting)

---

## Features

| Feature | Details |
|---|---|
| **Three connection methods** | iCal URL, Google Account (OAuth 2.0), or Apple Calendar |
| **Auto-create notes** | Notes created automatically N hours before each event |
| **Startup sweep** | Creates notes for events already within the advance window on launch |
| **Background polling** | Checks every 30 minutes (configurable) for events needing a note |
| **Past events** | Optionally create notes for past events within a configurable lookback window |
| **Event picker** | Fuzzy-search across upcoming events to create a note on demand |
| **Agenda from invite** | Event description is parsed and placed in the Agenda section |
| **Attendee RSVP table** | Attendees shown with name, email, and color-coded accept/decline status |
| **Conference links** | Google Meet, Zoom, and Microsoft Teams links detected and included (optional) |
| **YAML frontmatter** | Structured metadata compatible with Dataview and other plugins |
| **Flexible filenames** | Date before or after event name — your choice |
| **Idempotent** | Re-running never overwrites a note you've already started editing |

---

## Connection Methods

| Method | Best for | Auth required |
|---|---|---|
| **iCal URL** | Personal Google Calendar | None — just the secret URL |
| **Google Account** | Work/organization Google Calendar | Google OAuth 2.0 (one-time setup) |
| **Apple Calendar** | Any calendar synced to Calendar.app on macOS | None — reads locally |

Switch between methods at any time in **Settings → Google Calendar Note Integration → Authentication mode**.

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
duration: "1h"
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

---

## Agenda

- Review Q1 results
- Discuss Q2 OKRs
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

### Option A — BRAT (recommended for beta users)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) installs and auto-updates plugins directly from GitHub.

1. Install and enable **Obsidian42 - BRAT** from the Community Plugins list.
2. Open **Settings → BRAT → Add Beta plugin**.
3. Enter the repository URL:
   ```
   https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration
   ```
4. Click **Add Plugin**. BRAT downloads the latest release from the `main` branch automatically.
5. Enable **Google Calendar Note Integration** in **Settings → Community Plugins**.

### Option B — Manual installation

1. Go to the [Releases page](https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration/releases) and download the latest release assets: `main.js`, `manifest.json`, `styles.css`.
2. Copy them into your vault's plugin folder:
   ```
   <vault>/.obsidian/plugins/obsidian-google-calendar-notes/
   ```
3. Enable the plugin in **Settings → Community Plugins**.

### Option C — Build from source

```bash
git clone https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration.git
cd Obisian-Plugin-Calendar-Note-Integration
npm install
npm run build
cp main.js manifest.json styles.css "/path/to/vault/.obsidian/plugins/obsidian-google-calendar-notes/"
```

---

## Setup

Choose the connection method that matches your calendar:

---

### Option A — iCal URL (personal / public calendars)

Use this when your Google Calendar is personal (not managed by a workplace organization).

1. Open **Google Calendar** → **Settings** (gear icon).
2. Click your calendar's name in the left sidebar.
3. Scroll to **Integrate calendar**.
4. Copy the **Secret address in iCal format** URL (ends in `.ics`).
5. In Obsidian, open **Settings → Google Calendar Note Integration**.
6. Set **Authentication mode** to **iCal URL**.
7. Paste the URL into the **iCal URL** field.
8. Click **Test** to confirm the connection.

> **Security:** The secret iCal URL grants read access to your calendar to anyone who has it — treat it like a password. The plugin stores it encrypted in Obsidian's plugin data folder using your OS keychain.

---

### Option B — Google Account (work/org calendars)

Use this when your organization blocks external iCal access (you see "0 events" with the iCal method, or get an error about authentication).

#### One-time Google Cloud setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Go to **APIs & Services → Library** and enable the **Google Calendar API**.
3. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**.
4. Choose **Desktop app** as the application type.
5. Copy the **Client ID** and **Client Secret**.

> **Tip:** You may need to configure the OAuth consent screen first. Choose "External" and add your own email as a test user while in "Testing" mode.

#### Plugin setup

1. In Obsidian, open **Settings → Google Calendar Note Integration**.
2. Set **Authentication mode** to **Google Account**.
3. Paste your **Client ID** and **Client Secret**.
4. Click **Sign in with Google** — your browser opens Google's authorization page.
5. Sign in and grant read-only calendar access.
6. The browser shows "Authorization Successful" and Obsidian resumes automatically.

Authentication is a one-time step. The plugin stores a refresh token and automatically renews the access token in the background.

---

### Option C — Apple Calendar (macOS)

Use this to read from Calendar.app on macOS. All accounts already synced in Calendar.app — including Google, iCloud, Exchange, and others — are available without any additional authentication.

1. In Obsidian, open **Settings → Google Calendar Note Integration**.
2. Set **Authentication mode** to **Apple Calendar — macOS only**.
3. The plugin loads your available calendars automatically. Use the checkboxes to select which calendars to include. Leave all checked (or uncheck all) to include every calendar.
4. Click **Test** to verify Obsidian can read your events.

> **macOS permission:** On first use, macOS shows a dialog: *"Obsidian wants to access your calendars."* Click **Allow**. The permission is saved in **System Settings → Privacy & Security → Calendars**.

---

## Usage

### Automatic (recommended)

Once configured, the plugin runs quietly in the background:

- **On startup:** Checks for events starting within the next N hours (default: 12 h) and creates notes.
- **Every 30 minutes:** Re-checks for new events entering the advance window.
- Notes are created silently; a brief notice appears only when new notes are made.

### Manual — Command Palette

| Command | Description |
|---|---|
| `Create note from Google Calendar event` | Open the fuzzy-search event picker |
| `Create note for next upcoming event` | Instantly create a note for the very next event |
| `Auto-create notes for events in the next N hours` | Manual sweep with a summary |

### Manual — Ribbon Icon

Click the **calendar** icon in the left ribbon to open the event picker.

### Upgrading with BRAT

Run **Settings → BRAT → Check for updates** — BRAT handles everything automatically.

### Upgrading manually

1. Download the latest `main.js`, `manifest.json`, `styles.css` from [Releases](https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration/releases).
2. Overwrite the files in `<vault>/.obsidian/plugins/obsidian-google-calendar-notes/`.
3. Reload the plugin: **Settings → Community Plugins → Disable**, then **Enable**.

> **Your settings and tokens are preserved.** The `data.json` file is never overwritten by an upgrade.

---

## Configuration Reference

All settings are in **Settings → Google Calendar Note Integration**.

### Connection Method

| Setting | Description |
|---|---|
| **Authentication mode** | Choose iCal URL, Google Account, or Apple Calendar |

### iCal Connection

| Setting | Description |
|---|---|
| **iCal URL** | Secret iCal address from Google Calendar (encrypted at rest) |
| **Test** | Verify the URL returns valid data |

### Google Account

| Setting | Description |
|---|---|
| **Client ID** | OAuth 2.0 Client ID from Google Cloud Console |
| **Client Secret** | OAuth 2.0 Client Secret (encrypted at rest) |
| **Sign in with Google** | Opens browser for one-time authorization |
| **Disconnect** | Revokes authorization and clears stored tokens |
| **Calendar ID** | Calendar to fetch (`primary` = default calendar) |
| **Test** | Verify the OAuth token is valid |

### Apple Calendar

| Setting | Description |
|---|---|
| **Calendar checkboxes** | Select which Calendar.app calendars to include. Uncheck all to include every calendar. |
| **Test** | Verify Obsidian can read events from Calendar.app |

### Personal Settings

| Setting | Description |
|---|---|
| **Your email address** | Your calendar account email. When set, your own attendee entry is hidden from generated notes. |

### Note Settings

| Setting | Default | Range | Description |
|---|---|---|---|
| **Note folder** | `Meeting Notes` | any path | Vault folder for new notes. Empty = vault root |
| **Hours in advance** | `12` | 1–48 h | How far ahead of an event to auto-create its note |
| **Poll interval** | `30` | 5–120 min | How often to check for new events. Takes effect after restart. |
| **Include past events** | Off | — | Also create notes for events that have already started |
| **Days back to look** | `1` | 1–30 days | How many days back to look (shown when past events is enabled) |

### Note Contents

| Setting | Default | Description |
|---|---|---|
| **Include event notes / agenda** | On | Include the event's description as the Agenda section |
| **Include conference link** | Off | Extract and include Zoom, Teams, or Google Meet links |
| **Date position in filename** | Before name | `2026-03-30 - Meeting Title` or `Meeting Title - 2026-03-30` |

### Calendar View

| Setting | Default | Range | Description |
|---|---|---|---|
| **Days ahead to fetch** | `7` | 1–30 days | Look-ahead window for the event picker |
| **Max events to show** | `20` | 1–50 | Max events shown in the picker |

---

## Note Template Anatomy

Every generated note has the following structure:

```
YAML Frontmatter
  title, date, calendar_event_id, location?, attendees?, duration?, conference_platform?

# Event Title

**Date:**      Long-form date  (e.g. Monday, March 30, 2026)
**Time:**      Time range       (e.g. 10:00 AM – 11:00 AM, or "All day")
**Duration:**  Length of meeting (timed events only)
**Location:**  Physical location (if present)
**<Platform>:** [Join meeting](<url>)  (if conference links enabled and present)
**Organizer:** Name / email    (if present)

**Attendees:**
| 🟢/🔴/🟡/⚪/🔷 | Name | Email |

---

## Agenda        (if "Include event notes" enabled — bullet list from description)
## Notes         (empty bullet list for live notes)
## Summary       (empty bullet list for post-meeting summary)
## Actions       (empty bullet list for action items)
```

### Filename format

| Date position | Example |
|---|---|
| Before name (default) | `2026-03-30 - Q2 Planning Kickoff.md` |
| After name | `Q2 Planning Kickoff - 2026-03-30.md` |

Characters forbidden by common file systems (`\ / : * ? " < > |`) are replaced with hyphens.

---

## Security Model

### Credential storage

| Credential | Storage |
|---|---|
| iCal URL | Encrypted via OS keychain (Electron `safeStorage`) |
| OAuth Client Secret | Encrypted via OS keychain |
| OAuth access token | Encrypted via OS keychain |
| OAuth refresh token | Encrypted via OS keychain |

Encrypted tokens are stored as opaque blobs in `.obsidian/plugins/obsidian-google-calendar-notes/data.json`. They are machine-bound — moving your vault to another machine requires re-authentication.

### OAuth 2.0 flow

- Uses the **installed app** flow with a dynamically allocated localhost redirect port.
- A **cryptographically random `state` token** (`crypto.randomUUID()`) is generated per auth attempt to prevent CSRF.
- The local HTTP server shuts down immediately after the first valid redirect.
- A **5-minute timeout** aborts the flow if not completed.
- The plugin requests only the **`calendar.readonly`** scope — it cannot modify calendar data.

### Input sanitization

| Context | Threat | Mitigation |
|---|---|---|
| YAML frontmatter values | YAML injection via newlines | `escapeYaml()` escapes `\n`, `\r`, `\t`, `"`, `\` |
| Markdown headings / bold | Newlines breaking structure | `sanitizeInline()` collapses newlines |
| Markdown table cells | `\|` breaking table rows | `escapeMdCell()` escapes pipes and newlines |
| Conference link URIs | `javascript:` / `data:` URIs | `isSafeHttpsUrl()` only allows `https:` and `http:` |
| JXA script (Apple Calendar) | Script injection | Only validated integers are interpolated — never user strings |

### Network requests

- All requests use Obsidian's `requestUrl()` API (routes through Electron main process, bypasses CORS).
- iCal feeds capped at 10 MB. Apple Calendar output capped at 5 MB.
- All REST API calls have a 10-second timeout.

---

## Development

### Prerequisites

- Node.js 18+
- An Obsidian vault for testing

### Commands

```bash
npm install          # Install dependencies
npm run dev          # Development build (watch mode)
npm run build        # Production build
```

### Versioning

```bash
npm run version:patch   # bug fixes  →  e.g. 5.0.0 → 5.0.1
npm run version:minor   # new features  →  5.0.0 → 5.1.0
npm run version:major   # breaking changes  →  5.0.0 → 6.0.0
```

### Publishing a release

```bash
npm run build
git add manifest.json versions.json package.json main.js
git commit -m "Release vX.Y.Z"
git push origin main
# Then create a GitHub Release tagged X.Y.Z (no "v" prefix for BRAT compatibility)
# Attach: main.js, manifest.json, styles.css
```

### Architecture

```
src/
├── main.ts             Plugin entry point — commands, ribbon, polling
├── settings.ts         Settings interface, defaults, settings tab UI
├── calendarApi.ts      Unified CalendarService + IcalCalendarApi + GoogleCalendarApi
├── icalParser.ts       RFC 5545 iCal parser (Google Meet, Zoom, Teams detection)
├── appleCalendarApi.ts JXA-based Apple Calendar reader
├── googleAuth.ts       OAuth 2.0 authorize / refresh / revoke
├── noteCreator.ts      Markdown note builder + vault file writer
├── eventModal.ts       Fuzzy-search event picker modal
├── secureStorage.ts    Electron safeStorage wrapper
└── electron.d.ts       Electron type declarations
```

---

## Troubleshooting

### "Please configure your connection"

Open **Settings → Google Calendar Note Integration** and complete the setup for your chosen connection method.

### iCal: "0 events returned" or "did not return a valid calendar feed"

- Make sure you copied the **Secret address in iCal format** (not the public calendar URL).
- Your organization may have disabled external iCal access. Switch to **Google Account** mode instead.
- Open the developer console (**Ctrl+Shift+I** → Console) for the full error details.

### Google Account: "Authorization timed out" or "OAuth state mismatch"

Click **Sign in with Google** again to start a fresh authorization flow.

### Google Account: "Google Calendar API error: …"

The access token may have been revoked. Click **Disconnect** then **Sign in with Google** to re-authenticate.

### Apple Calendar: "Calendar access denied"

Go to **System Settings → Privacy & Security → Calendars** and toggle Obsidian to **Allow**.

### Apple Calendar: "No calendars found"

Ensure Calendar.app is open, has at least one account configured, and that Obsidian has calendar permission.

### Notes are not created automatically

1. Confirm the plugin is configured (connection test passes in Settings).
2. Check that **Hours in advance** is large enough to cover upcoming events.
3. Run the **"Auto-create notes for events in the next N hours"** command for a verbose status report.

---

## Privacy

This plugin communicates only with your calendar source (Google Calendar API, iCal URL, or local Calendar.app). No data is sent to any third-party server. Credentials are stored locally and encrypted using your OS keychain.

---

## License

MIT
