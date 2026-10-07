# Meeting Notes for Apple Calendar

An Obsidian plugin that turns your Apple Calendar into meeting notes: a note before every meeting, a Today panel with one-click join, Krisp transcripts, AI summaries by copy and paste, and action items tracked across all your meetings.

Reads events from **Apple Calendar on your Mac** — any account synced to Calendar.app, limited to the specific calendars you choose.

> **Deprecated sources:** the Google Calendar (OAuth 2.0) and iCal URL sources still work but are deprecated and may be removed in a future release. Use Apple Calendar instead — add your Google or Exchange account to Calendar.app and select its calendars in the plugin settings.

---

## Features

- **Automatic note creation** — notes appear before your meetings without any manual action
- **Local Apple Calendar** — reads Calendar.app on your Mac; choose exactly which calendars to include
- **Structured meeting notes** — searchable properties, a Meeting details box, and Agenda, Notes, Decisions, Action items, Meeting Summary, and Transcript sections
- **One-click join** — Zoom, Google Meet, Microsoft Teams, and Webex links are found in the event's URL, location, or description and shown as a **Join** link
- **Attendees with RSVP status** — 🟢 accepted, 🔴 declined, 🟡 tentative, ⚪ awaiting; optionally as `[[Name]]` links to your people notes
- **Notes stay in sync** — time, attendee, and location changes are applied to existing notes; moved meetings are renamed to their new date; cancelled meetings are marked cancelled
- **Recurring meetings** — every occurrence gets its own note, linked to the previous one, with last meeting's open action items in the Agenda
- **Your own template** — point the plugin at a template note with placeholders, or use the built-in format
- **Daily-note links** — each meeting links to that day's daily note, so the day's meetings appear in its backlinks
- **Next meeting in the status bar** — click it, or run **Join current or next meeting**, to open the note and join
- **Meetings dashboard** — a ready-made Bases view of upcoming and recent meetings ([guide](docs/DASHBOARDS.md))
- **Today's meetings** — a sidebar of today's meetings (arrows step to other days) with one-click **Open note**, **Join** and **New note** buttons ([guide](docs/DASHBOARDS.md))
- **Krisp transcripts** — fill a meeting's Transcript section from its Krisp recording, by command or automatically
- **AI summaries by copy and paste** — copy a meeting for Gemini, Claude, ChatGPT or Copilot (or your own agent), paste the reply back into Meeting Summary, Decisions and Action items; the plugin itself never goes online
- **File notes anywhere** — move finished notes into your own folders; the plugin still finds them
- **Skip rules** — no automatic notes for meetings titled Focus time, Lunch, etc., or with no one else invited
- **Action items view** — every open action item across your meetings in one sidebar, grouped by meeting, owner (`@Bob`), or due date (`📅 2026-10-10`), with priorities, ticked off in place ([guide](docs/DASHBOARDS.md))
- **Meeting tracker** — one page with overdue and upcoming items, high priorities, open items by account and person, recent decisions and this week's meetings ([guide](docs/DASHBOARDS.md))
- **Works with the Tasks plugin** — action items use its format (priority, created, due and done dates), for live lists in any note ([guide](docs/TASKS.md))
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
5. Enable **Meeting Notes for Apple Calendar** under **Settings → Community plugins**

BRAT checks for new releases when Obsidian starts. To update immediately, run **BRAT: Check for updates to all beta plugins and UPDATE** from the command palette.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/brianpavane/Obisian-Plugin-Calendar-Note-Integration/releases/latest)
2. Copy all three files to `<vault>/.obsidian/plugins/calendar-note-integration/`
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**

Manual installs do not update automatically.

---

## Setup

Open **Settings → Meeting Notes for Apple Calendar**. **Calendar source** defaults to Apple Calendar.

### Apple Calendar (macOS) — recommended

Reads events from the calendars on your Mac using Apple's **EventKit** framework — no API keys, no OAuth, no Google Cloud project required. Every account synced to Calendar.app is available: iCloud, Google, Exchange/Office 365, and local calendars. EventKit reads the Mac's local calendar store, so each check takes well under a second and makes no network requests.

**Required permission:**
1. The first time the plugin reads your calendars, macOS asks:
   *"Obsidian would like to access your Calendar data"*
2. Click **OK**. If you missed it, go to **System Settings → Privacy & Security → Calendars** and set Obsidian to **Full Calendar Access** (not **Add Only**), then restart Obsidian.

**Apple Calendar settings:**

| Setting | Default | Description |
|---------|---------|-------------|
| Calendars to include | *(all)* | Toggle the specific calendars to create notes from; turning all on (or all off) includes every calendar |
| Run diagnostics | — | Checks calendar access, lists your calendars, and reads the next 7 days of events |

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
| Note folder | Meeting Notes | Vault-relative folder for created notes. You can move notes anywhere in the vault afterwards — the plugin finds them by their `calendar_event_id` property |
| Hours in advance | 12 | Create notes for events starting within this many hours (1–48) |
| Poll interval | 30 min | How often to check for new upcoming events (5–120) |
| Include past events | Off | Also create notes for events that have already started |
| Days back | 1 | How many days back to look when past events are enabled (1–30) |
| Skip meetings titled | *(empty)* | Meetings whose title contains any of these words (one per line, any case) never get a note automatically — e.g. `Focus time`, `Lunch`, `Hold`. You can still create one by hand |
| Skip meetings with no one else invited | Off | Don't auto-create notes for events with no attendees besides you. Set **Your email address** so the plugin knows which attendee is you |
| Include event description | On | Add the event's description to the Agenda section of new notes |
| Link attendees | Off | Write the organizer and attendees as `[[Name]]` links instead of plain names and emails |
| Template file | *(built-in)* | A note to use as the template for new meeting notes — see [Custom templates](#custom-templates) |
| Sections in new notes | All on | Which sections the built-in format includes: Agenda, Notes, Decisions, Action items, Meeting Summary, Transcript. Ignored when a template file is set. Existing notes are not changed |
| Link to daily note | On | Link each meeting note to that day's daily note, using your Daily Notes format and folder |
| Show next meeting in status bar | On | Show the meeting in progress or coming up next at the bottom of the window; click it to join |
| Date position in filename | Before | `2026-01-15 - Meeting Name.md` or `Meeting Name - 2026-01-15.md` |

### Calendar View (event picker)

| Setting | Default | Description |
|---------|---------|-------------|
| Days ahead to fetch | 7 | Look-ahead window for the event picker modal (1–30) |
| Max events to show | 20 | Maximum events listed in the picker modal (1–50) |

### Krisp Transcripts

| Setting | Default | Description |
|---------|---------|-------------|
| Krisp folder | `~/Documents/Transcripts/Krisp Meetings` | Where Krisp saves recordings on this Mac: one folder per meeting, each with a `transcript.txt` (or `transcript.md`) |
| Import transcripts automatically | Off | After each sync, offer recordings for meetings that ended in the last 2 days with an empty **Transcript** section. You confirm every import. Off: only with the command |

### AI Assistant (copy and paste)

| Setting | Default | Description |
|---------|---------|-------------|
| Include instructions when copying | On | Put the instructions in front of the copied meeting. Turn off if your assistant already has its own instructions (a Gem, custom GPT, Claude Project or Copilot agent) |
| Instructions | *(built-in)* | What the assistant is asked to do. **Copy** puts them on the clipboard; **Reset to default** restores the built-in text |
| Save category, account and tags as properties | On | Save a reply's Category, Primary Account / Project and Search Tags as `meeting_category`, `account` and `tags` |

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
daily_note: "[[2026-01-15]]"
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
> **When:** [[2026-01-15|Thursday, January 15, 2026]] · 10:00 AM – 11:00 AM EST (1h)
> **Where:** Conference Room B
> **Join:** [Join Google Meet](https://meet.google.com/abc-defg-hij)
> **Organizer:** Alice Smith
> **Attendees:** 🟢 Alice Smith *(organizer)* · 🟢 Bob Jones · ⚪ Carol White

## Agenda

- Review Q1 goals
- Staffing update
- 

## Notes

- 

## Decisions

- 

## Action items

- [ ] 

## Meeting Summary



## Transcript

```

- **Properties** hold the meeting's details so you can search, sort, and query meetings (for example with Bases or Dataview). `meeting_url` is clickable in the Properties panel.
- **Meeting details** has the **Join** link, and the date links to the daily note. A cancelled meeting shows a red **Meeting cancelled** box instead.
- **Agenda** starts with the lines of the event description (when **Include event description** is on).
- **Agenda**, **Notes**, **Decisions**, and **Action items** are yours to fill in. Action items are checkboxes, so Obsidian's task search and the Tasks plugin can collect them across meetings.
- **Meeting Summary** and **Transcript** are empty sections at the end of the note, for pasting a summary and transcript from your recording or AI note-taker.

### Custom templates

Set **Template file** to a note in your vault, and new meeting notes are created from it. Use any of these placeholders:

| Placeholder | Value |
|---|---|
| `{{title}}` | Meeting title |
| `{{date}}` / `{{date_long}}` | `2026-01-15` / `Thursday, January 15, 2026` |
| `{{start_time}}` / `{{end_time}}` / `{{time}}` | `10:00 AM EST` / `11:00 AM EST` / `10:00 AM – 11:00 AM EST` |
| `{{start}}` / `{{end}}` | `2026-01-15T10:00` / `2026-01-15T11:00` |
| `{{duration}}` | `1h` |
| `{{location}}` | Location |
| `{{calendar}}` | Calendar name |
| `{{organizer}}` | Organizer |
| `{{attendees}}` | Attendees, comma-separated |
| `{{attendee_list}}` | Attendees as a bulleted list with RSVP status |
| `{{join_link}}` | `[Join Zoom](https://…)` |
| `{{meeting_url}}` / `{{platform}}` | The join URL / `Zoom` |
| `{{agenda}}` | Event description as bullets, then the previous meeting's open action items (ends with an empty bullet) |
| `{{description}}` | Event description as plain text |
| `{{description_callout}}` | Event description in a collapsed callout |
| `{{details}}` | The **Meeting details** box (kept up to date) |
| `{{daily_note}}` | Link to the day's daily note |
| `{{previous_meeting}}` | Link to the previous meeting in a recurring series |
| `{{event_id}}` | Calendar event ID |

- A line containing only placeholders that come out empty (for example `{{join_link}}` for an in-person meeting) is left out.
- The plugin always adds its calendar properties to the note's frontmatter, so updates keep working with any template. Your template's own frontmatter is kept; placeholders inside it should be quoted, for example `project: "{{calendar}}"`.
- Only the properties and the `{{details}}` box are updated later. Everything else is filled in once, when the note is created.
- Anything that isn't a placeholder — including Templater `<% %>` commands — is copied as-is. To run Templater commands, turn on Templater's **Trigger Templater on new file creation** for your meeting-notes folder.

The built-in template is:

```markdown
---
type: meeting
tags:
  - meeting
---

# {{title}}

{{details}}

## Agenda

{{agenda}}

## Notes

- 

## Decisions

- 

## Action items

- [ ] 

## Meeting Summary



## Transcript

```

### Recurring meetings

Each occurrence of a recurring meeting gets its own note, linked to the one before it:

- **Meeting details** shows a **Previous** link, and the note gets a `previous_meeting` property.
- A new note's **Agenda** lists the previous meeting's open action items under *Open items from last meeting*. They are plain bullets rather than checkboxes, so each item stays a single task in the earlier note — tick it off there or in the **Meeting action items** view.

Only meetings that repeat in Apple Calendar are linked; separate events that happen to share a title are not.

### Daily notes

With **Link to daily note** on, each meeting note gets a `daily_note` property linking to that day's daily note, named and placed according to Obsidian's **Daily notes** settings. Open a daily note and its **Backlinks** pane lists that day's meetings. To show them inside the daily note, add this to your daily-note template (requires the Dataview plugin):

````markdown
```dataview
TABLE start, location FROM [[]] AND #meeting SORT start
```
````

The plugin never edits daily notes, and the link moves with the meeting if it is rescheduled.

### Keeping notes up to date

Every poll, Refresh, and Rebuild updates the notes of meetings in the time window. The plugin only rewrites the calendar properties listed above (title, date, daily note, previous meeting, start, end, calendar, organizer, attendees, location, meeting link, status, and event ID) and the **Meeting details** box. Everything else in the note — your writing, extra properties, and tags you add — is never changed.

If a meeting moves to another day, its note is renamed to the new date (a title you edited in the filename is kept).

If a meeting disappears from Apple Calendar (deleted rather than cancelled), its note is marked `status: removed` with a red **Meeting removed from calendar** box. This only happens for meetings in the time window and from calendars the plugin read, so turning a calendar off never marks its notes. If the meeting comes back — for example it was moved more than a week out and is now back in range — the next sync restores the note. Notes created by versions before 6.7 get their properties updated but keep their original layout.

### Filing notes into your own folders

New notes are created in the **Note folder**, but you can move them anywhere in the vault once the meeting is done, as many folder levels deep as you like. The plugin finds meeting notes anywhere by their `calendar_event_id` property, so a filed note keeps its **Open note** button, its action items, its **Previous** link from the next meeting in the series, and its calendar updates. If a filed meeting moves to another day, the note is renamed in the folder you filed it in.

### Krisp transcripts

If you record meetings with Krisp, the plugin can copy a recording's transcript into the note's **Transcript** section. Set **Krisp folder** in settings (default `~/Documents/Transcripts/Krisp Meetings`), open the meeting note, and run **Import Krisp transcript into this note**.

- **Nothing is imported without your OK.** A window shows the meeting and the recording it found, with a dropdown of other likely recordings and **Don't import**. Click **Import** to go ahead, or **Choose another recording…** to pick from every recording.
- Recordings are matched by the start time in the transcript header (or folder name). Any recording started from 10 minutes before the meeting until it ends is offered, best first: a matching title, then a start within the usual join window (2 minutes early to 7 minutes late), then the closest start. Generic titles like "Zoom meeting" are fine — back-to-back meetings each get the recording that started nearest their own start, and a recording that started after a meeting ended is never offered for it.
- Only the transcript is copied; Krisp's header (title, time, length) is left out.
- The transcript only goes into an empty Transcript section; clear the section to import again.
- The note records which recording it came from (`krisp_recording`), so the same recording isn't offered for another meeting.
- Turn on **Import transcripts automatically** to be offered transcripts after every sync, for all meetings that ended in the last 2 days, in one window. Double-booked meetings never start with the same recording selected. Meetings you skip (or close the window on) aren't offered again until Obsidian restarts. It's off until you turn it on.

### AI summaries (copy and paste)

Use any AI assistant your organization approves — Gemini, Claude, ChatGPT, Copilot, or a custom agent of your own. The plugin never contacts any of them; it copies text for you to paste and files the reply you copy back:

1. Open the meeting note and run **Copy meeting for AI assistant**. It copies a **MEETING DETAILS** block from your calendar (title, date, time, attendees), your **Notes** and the **Transcript** — with the plugin's instructions in front, unless you turned **Include instructions when copying** off.
2. Paste it into your assistant, then copy its whole reply.
3. Back in the note, run **Add AI reply to this meeting**.

The plugin understands two kinds of reply:

- **The short format** the built-in instructions ask for (**Summary**, **Decisions**, **Action items** headings): the summary goes into **Meeting Summary**, decisions into **Decisions**, action items into **Action items**.
- **A full report from your own agent** (see **[AI agent instructions](docs/AGENT_INSTRUCTIONS.md)**): the whole report goes into **Meeting Summary**; bullets under **Key Decisions Made** go into **Decisions**; each row of the action items table becomes a checkbox in **Action items** — owners as `@[[Full Name]]` (or `(owner: Customer IT team)` for a role), priority as `⏫` / `🔼` / `🔽`, the date added as `➕ YYYY-MM-DD` and due dates as `📅 YYYY-MM-DD` — the [Tasks plugin's format](docs/TASKS.md). The report's **Category**, **Primary Account / Project** and **Search Tags** become the note's `meeting_category`, `account` and `tags` properties, for the **By account** and **By category** dashboard views.

Running it again with the same reply is safe: **Meeting Summary is replaced**, and decisions and action items already in the note (ticked or not) aren't added twice. Your own writing in Notes, Decisions and Action items is kept.

Both steps are optional. The note's sections are there for you to write in by hand either way.

---

## Commands

| Command | Description |
|---------|-------------|
| **Create note from calendar event** | Opens a fuzzy-search modal to pick any upcoming event |
| **Create note for next upcoming event** | Immediately creates and opens a note for the next upcoming event |
| **Auto-create notes for events in the next N hours** | Runs the same sweep as the background poll right away (N = **Hours in advance**) |
| **Join current or next meeting** | Opens the note for the meeting in progress (or starting within 30 minutes), creating it if needed, and opens its join link |
| **Open meetings dashboard** | Opens `Meetings.base` in your meeting-notes folder (created on first use) |
| **Open today's meetings** | Shows today's meetings in the right sidebar, with Open note and Join buttons, arrows to other days, and a New note button |
| **Open meeting action items** | Shows every open action item from your meeting notes in the right sidebar |
| **Open meeting tracker** | Rebuilds and opens `Meeting Tracker.md` in your meeting-notes folder: overdue, due soon, high priority, by account, by person, recent decisions, this week's meetings |
| **Import Krisp transcript into this note** | Suggests the open note's Krisp recording and, once you confirm, fills its empty Transcript section — see [Krisp transcripts](#krisp-transcripts) |
| **Copy meeting for AI assistant** | Copies the open note's meeting details, notes and transcript (and, if switched on, the instructions) — see [AI summaries](#ai-summaries-copy-and-paste) |
| **Add AI reply to this meeting** | Files the AI reply on the clipboard into the open note's Meeting Summary, Decisions and Action items, and its properties |

The plugin adds five buttons to the ribbon (the icon strip on the far left of the window):

| Icon | Opens |
|---|---|
| Calendar | The event picker — same as **Create note from calendar event** |
| Calendar with clock | The **Today's meetings** panel |
| Checklist | The **Meeting action items** panel |
| Dashboard (four squares) | The **Meetings dashboard** |
| Gauge | The **Meeting tracker** |

Hover over a button to see its name.

### Status bar

The status bar at the bottom of the window shows the meeting in progress (*Now: Standup · ends in 10 min*) or the next one (*Next: Design Review in 25 min*, *at 3:00 PM*, or *tomorrow at 9:00 AM*). Click it to open the meeting's note and join link. Turn it off with **Show next meeting in status bar**.

---

## Dashboards

New to these? **[Dashboards — a step-by-step guide](docs/DASHBOARDS.md)** explains what each one is, where to find it, and how to use it. Setting everything up for the first time? See **[Recommended setup](docs/SETUP.md)**. Using the Tasks plugin? See **[Tasks and meeting action items](docs/TASKS.md)**.

### Today's meetings

Click the **calendar-with-clock** button in the left ribbon (or run **Open today's meetings**). A panel in the right sidebar lists today's meetings in order: finished ones faded, the current one marked **Now**. Each has an **Open note** (or **Create note**) button and, while the meeting is still to come or in progress, a **Join** button. Use the **‹** / **›** arrows beside the date to see the day before or after, and **Today** to come back. **New note** asks for a title and creates a note from your template for a meeting that isn't on your calendar, dated on the day shown. It re-reads the calendar every 5 minutes, or straight away with **Refresh**.

### Meetings dashboard

Click the **dashboard** button in the left ribbon (or run **Open meetings dashboard**). It creates a [Bases](https://obsidian.md/help/bases) file (Obsidian 1.9 or later) listing every meeting note, with **Next 7 days**, **Last 7 days**, **By account**, **By category** and **All meetings** views. It is an ordinary `.base` file — edit its columns, filters, and views like any other base.

### Meeting action items

Click the **checklist** button in the left ribbon (or press **Cmd + P** and run **Open meeting action items**). This opens a panel in the right sidebar listing every unchecked task (`- [ ] …`) in your meeting notes, grouped by meeting with the newest first. Click a meeting to open its note; tick an item to check it off in that note. The list updates as you edit notes, and needs no other plugins.

Give an item an owner with `@Name` (or `@[[Full Name]]`) and a due date with `📅 2026-10-10` or `[due:: 2026-10-10]` (the Tasks plugin's formats). The menu at the top of the panel groups items **By meeting**, **By person**, or **By due date** (Overdue, Today, Next 7 days, Later, No due date); overdue dates show in red.

---

## Troubleshooting

### Apple Calendar — no events found

1. Run **Settings → Apple Calendar → Run Diagnostics** to identify the issue
2. Verify Obsidian has **Full Calendar Access** in **System Settings → Privacy & Security → Calendars**, then restart Obsidian
3. Open Calendar.app and check the meeting appears there — the plugin sees exactly what Calendar.app has synced

If the plugin can't read your calendar during a background check, it shows one notice and keeps retrying; the notice appears again only after a later failure that follows a success.

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
| Krisp and AI assistants | Krisp transcripts are read from a folder on this Mac. Meetings are only copied to your clipboard for an AI assistant; you choose where to paste them. |
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
