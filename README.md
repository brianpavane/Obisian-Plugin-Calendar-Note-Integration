# Google Calendar Note Integration

An [Obsidian](https://obsidian.md) plugin that creates structured meeting notes directly from your Google Calendar events.

Each note is pre-populated with the event's existing agenda/description, and includes ready-to-use sections for **Agenda**, **Notes**, **Summary**, and **Actions** — all formatted as bullet lists.

---

## Features

- Browse and search your upcoming Google Calendar events with a fuzzy-search picker
- Automatically imports the event's description/invite notes into the **Agenda** section
- Creates a structured Markdown note with four sections, each defaulting to a bullet list:
  - **Agenda** — populated from the calendar event description
  - **Notes** — live meeting notes
  - **Summary** — post-meeting summary
  - **Actions** — action items and follow-ups
- Includes event metadata in YAML frontmatter (date, attendees, calendar event ID, location)
- One-click note for the *next* upcoming event via a dedicated command
- Token auto-refresh — re-authenticates silently in the background

---

## Example Note

```markdown
---
title: "Q2 Planning Kickoff"
date: 2026-03-30
calendar_event_id: "abc123xyz"
location: "Conference Room B"
attendees:
  - "Alice Smith"
  - "Bob Jones"
conference_platform: "Google Meet"
---

# Q2 Planning Kickoff

**Date:** Monday, March 30, 2026
**Time:** 10:00 AM – 11:00 AM
**Location:** Conference Room B
**Google Meet:** [Join meeting](https://meet.google.com/xxx-yyy-zzz)
**Organizer:** Alice Smith
**Attendees:** Alice Smith, Bob Jones

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

---

## Setup

### 1. Create Google Cloud credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services → Library** and enable **Google Calendar API**
4. Go to **APIs & Services → Credentials** and click **Create Credentials → OAuth 2.0 Client ID**
5. Choose **Desktop app** as the application type
6. Download or copy the **Client ID** and **Client Secret**

### 2. Configure the plugin

1. Open Obsidian **Settings → Google Calendar Note Integration**
2. Paste your **Client ID** and **Client Secret**
3. Click **Authenticate** — your browser will open a Google sign-in page
4. Grant the requested calendar read-only permission
5. The browser will redirect to a local page confirming success; return to Obsidian

### 3. Optional settings

| Setting | Default | Description |
|---|---|---|
| Calendar ID | `primary` | Calendar to fetch events from |
| Days ahead | `7` | How far ahead to look for events |
| Max events | `20` | Maximum events shown in the picker |
| Note folder | `Meeting Notes` | Where new notes are created |

---

## Usage

### Via ribbon icon

Click the **calendar** icon in the left ribbon to open the event picker.

### Via command palette

| Command | Description |
|---|---|
| `Create note from Google Calendar event` | Open the fuzzy-search event picker |
| `Create note for next upcoming event` | Instantly create a note for the next event |

---

## Development

```bash
# Install dependencies
npm install

# Development build (watches for changes)
npm run dev

# Production build
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into your vault's `.obsidian/plugins/obsidian-google-calendar-notes/` folder.

---

## Privacy

This plugin communicates **only** with Google's Calendar API using your own OAuth credentials. No data is sent to any third-party server. Your tokens are stored locally in Obsidian's plugin data file (`data.json`).

---

## License

MIT
