# Google Calendar Note Integration

An [Obsidian](https://obsidian.md) plugin that creates structured meeting notes from your Google Calendar events — with **no API keys, no Google Cloud Console setup, and no OAuth flow required**.

Notes are pre-populated with the event's existing agenda/description and include ready-to-use sections for **Agenda**, **Notes**, **Summary**, and **Actions** — all formatted as bullet lists. Notes are created automatically in advance of your meetings, keeping your vault in sync with your calendar.

> **Desktop only.** This plugin requires Obsidian's desktop app.

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
| **No API keys required** | Connects via Google Calendar's built-in iCal URL — no Google Cloud Console, no OAuth |
| **Auto-create notes** | Notes created automatically N hours before each event (default: 12 h) |
| **Startup sweep** | On launch, notes created for any events already within the advance window |
| **Background polling** | Checks every 30 minutes (configurable) for events needing a note |
| **Event picker** | Fuzzy-search across upcoming events to create a note on demand |
| **Agenda from invite** | Event description parsed and placed in the Agenda section |
| **Attendee RSVP table** | Attendees shown with name, email, and color-coded RSVP status |
| **Conference links** | Google Meet links extracted and validated automatically |
| **Duration** | Meeting duration shown in the note header and YAML frontmatter |
| **YAML frontmatter** | Structured metadata for use with Dataview or other plugins |
| **Idempotent** | Re-running never overwrites a note you have already started editing |

---

## Example Note

```markdown
---
title: "Q2 Planning Kickoff"
date: 2026-03-30
calendar_event_id: "abc123xyz@google.com"
location: "Conference Room B"
attendees:
  - "Alice Smith <alice@example.com>"
  - "Bob Jones <bob@example.com>"
  - "Carol White <carol@example.com>"
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

### Option A — BRAT (recommended)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) lets you install and auto-update plugins directly from GitHub.

1. Install and enable **Obsidian42 - BRAT** from the Obsidian Community Plugins list.
2. Open **Settings → BRAT → Add Beta plugin**.
3. Enter the repository URL:
   ```
   https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration
   ```
4. Click **Add Plugin**. BRAT downloads the latest release automatically.
5. Enable **Google Calendar Note Integration** in **Settings → Community Plugins**.

Enable **Auto-update plugins at startup** in BRAT settings to receive future updates automatically.

---

### Option B — Manual installation from a GitHub release

1. Go to the [Releases page](https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration/releases) and download the **latest release assets**:
   - `main.js`
   - `manifest.json`
   - `styles.css`

2. Create the plugin folder in your vault if it doesn't exist:
   ```
   <vault>/.obsidian/plugins/obsidian-google-calendar-notes/
   ```

3. Copy the three files into that folder.

4. In Obsidian: **Settings → Community Plugins** → refresh icon → enable **Google Calendar Note Integration**.

---

### Option C — Build from source

```bash
# Clone the repository
git clone https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration.git
cd Obisian-Plugin-Calendar-Note-Integration

# Install dependencies and build
npm install
npm run build

# Copy to your vault
cp main.js manifest.json styles.css \
  "/path/to/your/vault/.obsidian/plugins/obsidian-google-calendar-notes/"
```

Enable the plugin in **Settings → Community Plugins**.

---

## Upgrading

### Upgrading with BRAT

Run **Settings → BRAT → Check for updates**, or enable auto-update. BRAT handles everything.

### Upgrading a manual installation

1. Download the latest `main.js`, `manifest.json`, and `styles.css` from the [Releases page](https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration/releases).
2. Overwrite the existing files in your vault's plugin folder.
3. **Settings → Community Plugins** → disable then re-enable the plugin (or restart Obsidian).

> **Your `data.json` is preserved** — settings are never overwritten by an upgrade.

> **Upgrading from v1.1.0 (OAuth version):** The iCal branch uses a completely different connection method. After upgrading, open Settings and paste your Google Calendar iCal URL. Your previous OAuth credentials (Client ID, Client Secret, tokens) are no longer used and can be removed from `data.json` manually if desired.

### Upgrading a source build

```bash
git pull origin ical
npm run build
cp main.js manifest.json styles.css \
  "/path/to/your/vault/.obsidian/plugins/obsidian-google-calendar-notes/"
```

---

## Setup

### Step 1 — Get your Google Calendar iCal URL

1. Open [Google Calendar](https://calendar.google.com) in your browser.
2. In the left sidebar, hover over the calendar you want to connect and click the **⋮ three-dot menu**.
3. Select **Settings and sharing**.
4. Scroll down to the **Integrate calendar** section.
5. Find **"Secret address in iCal format"** and click the copy icon.

> **Which calendar to choose?** For personal meetings, use your primary calendar. For work calendars, choose the one where your meeting invites appear.

> **Tip:** The URL ends in `/basic.ics`. Keep it secret — anyone with this URL can read your calendar.

### Step 2 — Configure the plugin

1. In Obsidian, open **Settings → Google Calendar Note Integration**.
2. Paste the iCal URL into the **iCal URL** field.
3. Click **Test** to verify the connection. You should see a confirmation with the event count.
4. Optionally set **Your email address** so your own entry is hidden from the attendees table.

### Step 3 — Done

The plugin will automatically create meeting notes based on your settings. Use the **Refresh** button in Settings or the command palette to trigger an immediate sweep.

---

## Usage

### Commands (Command Palette)

| Command | Description |
|---|---|
| **Create note from Google Calendar event** | Opens a fuzzy-search picker to choose any upcoming event |
| **Create note for next upcoming event** | Immediately creates a note for the soonest event |
| **Auto-create notes for events in the next N hours** | Manual trigger for the same sweep that runs on startup and every poll interval |

### Ribbon icon

Click the calendar icon in the left ribbon to open the event picker (same as the first command above).

### Automatic note creation

The plugin creates notes automatically in two ways:
- **On startup:** A 5-second delayed sweep creates notes for all events starting within the next N hours.
- **On schedule:** Every `pollIntervalMinutes` minutes (default: 30), the plugin checks for new events.

Notes are **idempotent** — if a note file already exists at the computed path, it is returned as-is. Your edits are never overwritten.

---

## Configuration Reference

| Setting | Default | Range | Description |
|---|---|---|---|
| **iCal URL** | _(empty)_ | — | Google Calendar secret address (ends in `.ics`) |
| **Your email address** | _(empty)_ | — | Hides your own entry from the attendees table |
| **Note folder** | `Meeting Notes` | any path | Vault-relative folder for new notes. Empty = vault root |
| **Hours in advance** | `12` | 1–48 h | How far before an event to auto-create its note |
| **Poll interval** | `30` | 5–120 min | How often to check for new events needing a note |
| **Days ahead** | `7` | 1–30 days | Lookahead window for the event picker |
| **Max events** | `20` | 1–50 | Maximum events shown in the picker |

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
(one row per attendee, excluding your own entry if selfEmail is set)

---

## Agenda
  (bullet list pre-populated from the event description, or empty bullet)

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

Characters forbidden by common file systems (`\ / : * ? " < > |`) are replaced with hyphens. Leading dots are stripped (prevents hidden files on Unix).

---

## Security Model

### iCal URL

The iCal "secret address" is a long, unguessable URL that grants **read-only** access to your calendar without requiring sign-in. It is:

- **Stored in plaintext** in `.obsidian/plugins/obsidian-google-calendar-notes/data.json`.
- **Read-only** — it cannot be used to create, modify, or delete calendar events.
- **Revocable** — if compromised, go to Google Calendar → Settings → [calendar] → Integrate calendar → **Reset secret address**. The plugin will need to be updated with the new URL.

### iCal data in transit

All iCal fetches use HTTPS. The `singleevents=true` parameter is appended to Google Calendar URLs automatically; no other query parameters are added.

### Note content

Meeting notes are written as plain Markdown files inside your vault. All values derived from calendar event data are sanitised before being written:

| Risk | Mitigation |
|---|---|
| YAML injection | `escapeYaml()` escapes backslashes, quotes, and control characters |
| Markdown injection | `sanitizeInline()` strips newlines from heading/bold fields |
| Table injection | `escapeMdCell()` escapes pipes and newlines in attendee data |
| URL injection | `isSafeHttpsUrl()` rejects non-HTTP(S) schemes from conference links |
| HTML in description | `DOMParser` strips tags spec-compliantly before inserting into Markdown |

### Fetch safety

Each iCal fetch has a 15-second `AbortController` timeout. Network errors and non-2xx responses are caught and surfaced as Obsidian Notices rather than crashing the plugin.

### Vault access

Ensure your vault folder is not shared publicly or synced to a location accessible by untrusted parties — meeting details (agenda, attendee names and emails) appear in plain text in generated notes.

---

## Architecture

### Source files

| File | Purpose |
|---|---|
| `src/main.ts` | Plugin lifecycle, commands, polling, selfEmail filtering |
| `src/settings.ts` | `GoogleCalendarSettings` interface and settings tab UI |
| `src/icalParser.ts` | RFC 5545 iCal parser → `CalendarEvent[]` |
| `src/calendarApi.ts` | `IcalCalendarApi`: fetch, parse, filter by time window |
| `src/noteCreator.ts` | Markdown note builder + vault file writer |
| `src/eventModal.ts` | `FuzzySuggestModal` for the event picker |
| `styles.css` | Plugin CSS (settings tab, event picker suggestions) |
| `manifest.json` | Obsidian plugin manifest |
| `versions.json` | Maps plugin versions → minimum Obsidian app versions |
| `CHANGELOG.md` | Release history |
| `esbuild.config.mjs` | esbuild bundler configuration |
| `version-bump.mjs` | Version bump script (updates manifest, package, versions) |
| `tsconfig.json` | TypeScript compiler configuration |

### Data flow

```
Google Calendar iCal URL
        │
        ▼  (IcalCalendarApi.fetchAllEvents)
  Raw .ics text
        │
        ▼  (icalParser.parseIcal)
  CalendarEvent[]   ──► filter by time window
        │
        ▼  (noteCreator.createNoteFile)
  Markdown note content  ──► Obsidian vault file
        │
        ▼  (eventModal.ts)
  FuzzySuggestModal  ──► user picks event ──► createNoteFile
```

---

## Development

### Prerequisites

- Node.js 18+
- An Obsidian vault for testing

### Commands

```bash
npm install          # Install dependencies
npm run dev          # Watch mode (rebuilds on file changes)
npm run build        # Production build (type-check + minified bundle)
```

### Versioning

```bash
npm run version:patch   # Bug fixes       →  e.g. 1.2.0 → 1.2.1
npm run version:minor   # New features    →  e.g. 1.2.1 → 1.3.0
npm run version:major   # Breaking change →  e.g. 1.3.0 → 2.0.0
```

After bumping, update `CHANGELOG.md`, build, commit, and create a GitHub Release:

```bash
npm run build
git add manifest.json versions.json package.json CHANGELOG.md main.js
git commit -m "Release X.Y.Z"
git tag X.Y.Z
git push origin ical --tags
```

> **No `v` prefix on tags.** Obsidian's release validator requires the tag to exactly match the `version` field in `manifest.json` (e.g. `1.2.0`, not `v1.2.0`).

Then create a GitHub Release at the [releases page](https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration/releases/new), attach `main.js`, `manifest.json`, and `styles.css` as assets, and publish. BRAT users will be offered the upgrade on their next Obsidian startup.

### Installing the dev build

```bash
cp main.js manifest.json styles.css \
  "/path/to/your/vault/.obsidian/plugins/obsidian-google-calendar-notes/"
```

Then reload the plugin in Obsidian (**Settings → Community Plugins** → disable / enable).

---

## Troubleshooting

### "No iCal URL configured"

Open **Settings → Google Calendar Note Integration** and paste your iCal URL. See [Setup](#setup) for instructions on finding it.

### Test connection fails

- Confirm the URL ends in `.ics` and was copied from **Google Calendar → Settings → Integrate calendar → Secret address in iCal format**.
- Check that Obsidian has internet access.
- If the URL was recently **reset** in Google Calendar, paste the new one.

### Notes are not being created automatically

1. Confirm the iCal URL is configured and the Test button succeeds.
2. Check that **Hours in advance** is set high enough to cover upcoming events.
3. Use the **"Auto-create notes for events in the next N hours"** command (verbose mode) to see exactly what the sweep finds.

### Recurring events are missing

The plugin appends `singleevents=true` to Google Calendar iCal URLs automatically, which asks Google to expand recurring instances server-side. If a recurring event is still missing:
- Confirm the URL is a Google Calendar URL (contains `calendar.google.com`).
- Check that the event instance falls within the time window being fetched.
- Try the **Refresh** button in Settings for an immediate re-fetch.

### Attendees table shows my own entry

Set **Your email address** in Settings to your Google account email. The plugin will then mark your attendee entry as `self` and exclude it from the table.

### Note folder is not being created

Ensure **Note folder** in Settings contains only valid folder characters. Leave it empty to use the vault root.

### "iCal URL" field shows asterisks (password hidden)

This is intentional — the iCal URL is treated as a secret credential and displayed as a password field to prevent shoulder-surfing. The URL is stored as plaintext in `data.json` within your vault.

---

## Privacy

This plugin communicates **only** with `calendar.google.com` using your iCal URL. No data is sent to any third-party server. The iCal URL is stored locally in Obsidian's plugin data file.

### Vault access and iCal URL security

- **The iCal URL is read-only** — it cannot be used to modify your calendar.
- **The iCal URL is revocable** — reset it in Google Calendar if you believe it has been compromised. Update the plugin settings with the new URL.
- **Notes contain calendar data in plain text** — meeting titles, descriptions, attendee names, and email addresses are written to `.md` files in your vault. Ensure your vault is not publicly accessible.

---

## License

MIT
