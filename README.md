# Calendar Note Integration - Apple-iCal-Google

An Obsidian plugin that automatically creates structured meeting notes from your calendar events.

Reads events from **Apple Calendar on your Mac** — any account synced to Calendar.app, limited to the specific calendars you choose.

> **Deprecated sources:** the Google Calendar (OAuth 2.0) and iCal URL sources still work but are deprecated and may be removed in a future release. Use Apple Calendar instead — add your Google or Exchange account to Calendar.app and select its calendars in the plugin settings.

---

## Features

- **Automatic note creation** — notes appear before your meetings without any manual action
- **Local Apple Calendar** — reads Calendar.app on your Mac; choose exactly which calendars to include
- **Structured meeting notes** — searchable properties, a Meeting details box, and Agenda, Notes, Decisions, and Action items sections
- **One-click join** — Zoom, Google Meet, Microsoft Teams, and Webex links are found in the event's URL, location, or description and shown as a **Join** link
- **Attendees with RSVP status** — 🟢 accepted, 🔴 declined, 🟡 tentative, ⚪ awaiting; optionally as `[[Name]]` links to your people notes
- **Notes stay in sync** — time, attendee, and location changes are applied to existing notes; moved meetings are renamed to their new date; cancelled meetings are marked cancelled
- **Recurring meetings** — every occurrence gets its own note
- **Declined event filtering** — events you have declined are skipped, when the calendar identifies you as an attendee or your email address is set
- **All-day event filtering** — all-day events (holidays, OOO blocks) are skipped
- **Configurable time window** — look ahead 1–48 hours; optionally include past events
- **Background polling** — re-checks on a configurable interval (5–120 minutes)
- **Rebuild on demand** — recreate notes for deleted events with a single button click
- Requires macOS and Obsidian 1.4.10 or later

---

## Installation

The plugin is not listed in the Obsidian Community Plugins directory. Install it with **BRAT**, which installs plugins straight from their GitHub releases and keeps them updated.

### With BRAT (recommended)

1. In Obsidian, open **Settings → Community plugins → Browse**, search for **BRAT** (by TfTHacker), then click **Install** and **Enable**
2. Open the command palette (Cmd+P) and run **BRAT: Add a beta plugin for testing**
3. Enter the repository URL: `https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration`
4. Choose the latest version and click **Add Plugin**
5. Enable **Calendar Note Integration - Apple-iCal-Google** under **Settings → Community plugins**

BRAT checks for new releases when Obsidian starts. To update immediately, run **BRAT: Check for updates to all beta plugins and UPDATE** from the command palette.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration/releases/latest)
2. Copy all three files to `<vault>/.obsidian/plugins/calendar-note-integration/`
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**

Manual installs do not update automatically.

---

## Setup

Open **Settings → Calendar Note Integration - Apple-iCal-Google**. **Calendar source** defaults to Apple Calendar.

### Apple Calendar (macOS) — recommended

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
| Calendars to include | *(all)* | Toggle the specific calendars to create notes from; turning all on (or all off) includes every calendar |
| Timeout per calendar | 30 s | Seconds to wait per calendar in fallback tiers (15–300 s) |
| Max events for last-resort scan | 250 | Upper bound for Tier 3 fallback (50–2000) |
| Skip full scan | Off | Disable Tier 3 entirely for very large Exchange calendars |

### Google Calendar — iCal URL (deprecated)

No Google Cloud project needed. Uses the private iCal feed URL from your Google Calendar account.

1. Open [Google Calendar](https://calendar.google.com) → **Settings (gear icon)**
2. Click your calendar name in the left sidebar
3. Scroll to **Integrate calendar**
4. Copy the **Secret address in iCal format** URL
5. Paste it into **Settings → iCal URL** in Obsidian

### Google Calendar — OAuth 2.0 (deprecated)

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
| Your email address | Identifies your own attendee entry when the calendar doesn't. Used to omit you from the attendee table and skip events you have declined. |

### Note Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Note folder | Meeting Notes | Vault-relative folder for created notes |
| Hours in advance | 12 | Create notes for events starting within this many hours (1–48) |
| Poll interval | 30 min | How often to check for new upcoming events (5–120); takes effect after restart |
| Include past events | Off | Also create notes for events that have already started |
| Days back | 1 | How many days back to look when past events are enabled (1–30) |
| Include event description | On | Add the event's original description to new notes in a collapsed callout |
| Link attendees | Off | Write the organizer and attendees as `[[Name]]` links instead of plain names and emails |
| Date position in filename | Before | `2026-01-15 - Meeting Name.md` or `Meeting Name - 2026-01-15.md` |

### Calendar View (event picker)

| Setting | Default | Description |
|---------|---------|-------------|
| Days ahead to fetch | 7 | Look-ahead window for the event picker modal (1–30) |
| Max events to show | 20 | Maximum events listed in the picker modal (1–50) |

### Manual Actions

| Button | Description |
|--------|-------------|
| **Refresh** | Immediately fetch events, create notes for new events, and update existing notes. Notes you deleted are not recreated. |
| **Rebuild** | Same as Refresh, but also recreates notes you deleted. Runs automatically once after each install or upgrade. |

---

## Generated Note Format

```markdown
---
type: meeting
title: "Weekly Sync"
date: 2026-01-15
start: 2026-01-15T10:00
end: 2026-01-15T11:00
calendar: "Work"
organizer: "Alice Smith <alice@example.com>"
attendees:
  - "Alice Smith <alice@example.com>"
  - "Bob Jones <bob@example.com>"
  - "Carol White <carol@example.com>"
location: "Conference Room B"
meeting_url: "https://meet.google.com/abc-defg-hij"
conference_platform: "Google Meet"
calendar_event_id: "7F3A…::2026-01-15T15:00:00.000Z"
tags:
  - meeting
---

# Weekly Sync

> [!info] Meeting details
> **When:** Thursday, January 15, 2026 · 10:00 AM – 11:00 AM (1h)
> **Where:** Conference Room B
> **Join:** [Join Google Meet](https://meet.google.com/abc-defg-hij)
> **Organizer:** Alice Smith
> **Attendees:** 🟢 Alice Smith *(organizer)* · 🟢 Bob Jones · ⚪ Carol White

> [!quote]- Event description
> Review Q1 goals
> Staffing update

## Agenda

- 

## Notes

- 

## Decisions

- 

## Action items

- [ ] 
```

- **Properties** hold the meeting's details so you can search, sort, and query meetings (for example with Bases or Dataview). `meeting_url` is clickable in the Properties panel.
- **Meeting details** has the **Join** link. A cancelled meeting shows a red **Meeting cancelled** box instead.
- **Event description** (collapsed) is the original invite text; it appears only when **Include event description** is on.
- **Agenda**, **Notes**, **Decisions**, and **Action items** are yours to fill in. Action items are checkboxes, so Obsidian's task search and the Tasks plugin can collect them across meetings.

### Keeping notes up to date

Every poll, Refresh, and Rebuild updates the notes of meetings in the time window. The plugin only rewrites the calendar properties listed above (title, date, start, end, calendar, organizer, attendees, location, meeting link, status, and event ID) and the **Meeting details** box. Everything else in the note — your writing, extra properties, and tags you add — is never changed.

If a meeting moves to another day, its note is renamed to the new date (a title you edited in the filename is kept). Notes created by versions before 6.7 get their properties updated but keep their original layout.

---

## Commands

| Command | Description |
|---------|-------------|
| **Create note from calendar event** | Opens a fuzzy-search modal to pick any upcoming event |
| **Create note for next upcoming event** | Immediately creates and opens a note for the next upcoming event |
| **Auto-create notes for events in the next N hours** | Runs the same sweep as the background poll right away (N = **Hours in advance**) |

The ribbon icon (calendar icon, left sidebar) opens the same event picker as **Create note from calendar event**.

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
- Use the **Rebuild** button (Settings → Manual Actions) to force a re-check
- Cancelled meetings never get a new note
- Check the Obsidian developer console (Cmd+Option+I → Console) for `[CalendarNoteIntegration]` warnings and errors. For step-by-step Apple Calendar fetch details, set the console's log level to include **Verbose**.

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
- Conference link URIs must be HTTPS before they are embedded
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
