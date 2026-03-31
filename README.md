# Calendar Note Integration - Apple-iCal-Google

An Obsidian plugin that automatically creates structured meeting notes from your calendar events.

Supports **Apple Calendar** (macOS), **Google Calendar** (via OAuth 2.0 or secret iCal URL), and **any standard iCal feed**.

---

## Features

- **Automatic note creation** — notes appear before your meetings without any manual action
- **Three calendar sources** — Apple Calendar, Google Calendar OAuth, or any iCal/CalDAV URL
- **Structured note template** — Agenda (from event description), Notes, Summary, and Actions sections
- **Attendee table** — shows every participant with their RSVP status (🟢 accepted, 🔴 declined, 🟡 tentative, ⚪ awaiting)
- **Conference link extraction** — Zoom, Google Meet, and Microsoft Teams links are pulled into the note header
- **Declined event filtering** — events you have declined are never given notes
- **All-day event filtering** — all-day events (holidays, OOO blocks) are skipped
- **Configurable time window** — look ahead 1–72 hours; optionally include past events
- **Background polling** — re-checks on a configurable interval (1–60 minutes)
- **Reimport on demand** — recreate notes for deleted events with a single button click
- macOS only for Apple Calendar mode; iCal and OAuth work on any desktop platform

---

## Installation

### From Obsidian Community Plugins (recommended)

1. Open Obsidian → **Settings → Community plugins → Browse**
2. Search for **Calendar Note Integration**
3. Click **Install**, then **Enable**

### Manual installation

1. Download `main.js` and `manifest.json` from the [latest release](https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration/releases/latest)
2. Copy both files to `<vault>/.obsidian/plugins/calendar-note-integration/`
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**

---

## Setup

Open **Settings → Calendar Note Integration - Apple-iCal-Google** and choose a connection method.

### Apple Calendar (macOS)

Reads events directly from **Calendar.app** using Apple's **EventKit** framework — no API keys, no OAuth, no Google Cloud project required. All accounts synced to Calendar.app are available: Google CalDAV, iCloud, Exchange/Office 365, and local calendars.

**Required permission:**
1. The first time the plugin runs, macOS will prompt:
   *"Obsidian would like to access your Calendar data"*
2. Click **OK**. If you missed it, go to **System Settings → Privacy & Security → Calendars** and set Obsidian to **Full Calendar Access**.

**How event fetching works:**

The plugin uses a tiered strategy, always trying the fastest approach first:

| Tier | Method | Notes |
|------|--------|-------|
| **EventKit global** *(primary)* | `EKEventStore` via ObjC — single call, all calendars | Reads local SQLite cache, no network. < 100 ms. |
| Tier 1 | `app.eventsFrom()` — Calendar.app scripting bridge | Fast for some configurations |
| Tier 2 | `cal.eventsFrom()` with NSDate — per calendar | CalDAV/Exchange date-range query |
| Tier 2.5 | `whose`-predicate filter | Exchange fallback |
| Tier 2.75 | Bulk `events.startDate()` fetch | Large Exchange calendars |
| Tier 3 | Lazy indexed `events[j]` scan | Last resort |

For most users, **EventKit global** handles everything in a single call and the remaining tiers are never reached.

**Apple Calendar Settings:**

| Setting | Default | Description |
|---------|---------|-------------|
| Calendars to include | *(all)* | Toggle specific calendars or leave blank for all |
| Timeout per calendar | 30 s | Seconds to wait per calendar in fallback tiers (15–300 s) |
| Max events for last-resort scan | 250 | Upper bound for Tier 3 fallback (50–2000) |
| Skip full scan | Off | Disable Tier 3 entirely for very large Exchange calendars |

### Google Calendar — iCal URL

No Google Cloud project needed. Uses the private iCal feed URL from your Google Calendar account.

1. Open [Google Calendar](https://calendar.google.com) → **Settings (gear icon)**
2. Click your calendar name in the left sidebar
3. Scroll to **Integrate calendar**
4. Copy the **Secret address in iCal format** URL
5. Paste it into **Settings → iCal URL** in Obsidian

### Google Calendar — OAuth 2.0

Full API access. Required for shared/workspace calendars or precise filtering.

**One-time Google Cloud setup:**

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project and enable the **Google Calendar API**
3. Go to **APIs & Services → OAuth consent screen** → External → add your account as a test user
4. Go to **Credentials → Create Credentials → OAuth client ID** → Desktop app
5. Copy the **Client ID** and **Client Secret** into Obsidian Settings, then click **Sign in with Google**
6. Enter the **Calendar ID** (found in Google Calendar → Settings → Integrate calendar)

---

## Settings Reference

### Personal

| Setting | Description |
|---------|-------------|
| Your email address | Identifies your own attendee entry. Used to show your RSVP status and exclude events you have declined. |

### Note Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Note folder | *(vault root)* | Vault-relative folder for created notes |
| Hours in advance | 24 | Create notes for events starting within this many hours |
| Poll interval | 5 min | How often to check for new upcoming events |
| Include past events | Off | Also create notes for events that have already started |
| Days back | 1 | How many days back to look (when past events enabled) |
| Include event notes | On | Include the event description as the Agenda section |
| Include conference link | Off | Add a Join Meeting link to the note header |
| Date position in filename | Before | `2026-01-15 - Meeting Name.md` or `Meeting Name - 2026-01-15.md` |

### Calendar View (event picker)

| Setting | Default | Description |
|---------|---------|-------------|
| Days ahead to fetch | 7 | Look-ahead window for the event picker modal |
| Max events to show | 10 | Maximum events listed in the picker modal |

### Manual Actions

| Button | Description |
|--------|-------------|
| **Refresh** | Immediately fetch events and create any missing notes |
| **Reimport** | Re-runs the full import and recreates notes for any events whose notes were deleted. Existing notes are not overwritten. |

---

## Generated Note Format

```markdown
---
title: "Weekly Sync"
date: 2026-01-15
calendar_event_id: "abc123..."
location: "Conference Room B"
attendees:
  - "Alice Smith <alice@example.com>"
  - "Bob Jones <bob@example.com>"
duration: "1h 0m"
conference: "Google Meet"
---

# Weekly Sync

**Date:** Wednesday, January 15, 2026
**Time:** 10:00 AM - 11:00 AM
**Duration:** 1h 0m
**Google Meet:** [Join meeting](https://meet.google.com/abc-defg-hij)
**Organizer:** Alice Smith

**Attendees:**

|   | Name | Email |
|:-:|:-----|:------|
| green | Alice Smith *(organizer)* | alice@example.com |
| green | Bob Jones | bob@example.com |
| white | Carol White | carol@example.com |

---

## Agenda

- Weekly status update
- Q1 planning discussion

---

## Notes



---

## Summary



---

## Actions


```

---

## Commands

| Command | Description |
|---------|-------------|
| **Create note from calendar event** | Opens a fuzzy-search modal to pick any upcoming event |
| **Create note for next event** | Immediately creates and opens a note for the next upcoming event |

Both commands are also available via the ribbon icon (calendar icon, left sidebar).

---

## Troubleshooting

### Apple Calendar — no events found

1. Run **Settings → Apple Calendar → Run Diagnostics** to identify the issue
2. Verify Obsidian has **Full Calendar Access** in **System Settings → Privacy & Security → Calendars**
3. Make sure Calendar.app is open and the relevant calendars are synced and enabled

### Apple Calendar — timeout or slow

The **EventKit global** path (primary) reads the local cache and is not expected to time out. If it falls through to the Calendar.app scripting bridge:
- Open Calendar.app and wait for it to finish syncing, then retry
- Increase **Timeout** in Settings → Apple Calendar → Advanced
- For very large Exchange calendars, enable **Skip full scan**

### Notes not being created

- Check **Hours in advance** — events too far in the future are not in the window yet
- Check **Your email address** — if set, declined events are filtered out
- Use the **Reimport** button (Settings → Manual Actions) to force a re-check
- Check the Obsidian developer console (Ctrl+Shift+I → Console) for `[CalendarNoteIntegration]` log entries

### Google Calendar — authentication errors

- **OAuth**: click **Sign in with Google** in Settings to refresh the token
- **iCal**: verify the secret iCal URL is still valid; regenerate it in Google Calendar if needed

---

## Privacy and Security

| Mode | Data handling |
|------|--------------|
| Apple Calendar | All data stays on-device. No network requests are made by the plugin; Calendar.app manages its own syncing independently. |
| iCal URL | The plugin fetches your iCal URL directly from Obsidian. The URL is stored encrypted in your vault. |
| OAuth | Access tokens are stored encrypted in your vault. The plugin requests read-only scope (`calendar.readonly`). No data is sent to any third-party server. |

Security measures in the code:

- All user-controlled strings written to YAML frontmatter are escaped to prevent injection
- Markdown table fields (attendee names/emails) are sanitised against pipe/newline injection
- Conference link URIs are validated against an HTTPS allowlist before embedding
- JXA scripts interpolate only validated integers (never raw user strings)
- `execFile` is used instead of `exec` — no shell expansion possible
- OAuth refresh tokens are preserved across refreshes to prevent auth loss
- JXA output is capped at 5 MB before JSON parsing to prevent OOM

---

## Building from Source

```bash
git clone https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration.git
cd Obisian-Plugin-Calendar-Note-Integration
npm install
npm run build   # production build -> main.js
npm run dev     # watch mode for development
```

---

## License

MIT
