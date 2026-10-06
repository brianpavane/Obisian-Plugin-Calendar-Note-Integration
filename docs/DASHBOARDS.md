# Dashboards — a step-by-step guide

The plugin gives you two dashboards. A dashboard is a page that pulls information out of all your meeting notes and shows it in one place, so you don't have to open each note.

| Dashboard | What it answers | Where it appears |
|---|---|---|
| **Meeting action items** | "What did I promise to do, in any meeting?" | A panel in the **right sidebar** |
| **Meetings dashboard** | "What meetings do I have coming up, and what did I have last week?" | A table that opens in the **main editor area**, like a note |

Both are built only from the meeting notes the plugin created (notes in your **Note folder**, default `Meeting Notes`). They never change your calendar.

---

## How to run a command (you need this for both)

Both dashboards are opened with a *command*. Obsidian runs commands from the **command palette**:

1. Press **Cmd + P** (or click the **>_** "Open command palette" icon in the left ribbon).
2. A search box appears. Start typing the command's name, for example `action items`.
3. Click the matching line, or press **Return**.

In the palette, every command from this plugin starts with **Calendar Note Integration - Apple-iCal-Google:**, so typing `calendar` lists them all.

> **Tip — give it a shortcut.** Open **Settings → Hotkeys**, search for `action items` (or `meetings dashboard`), click the **+** next to the command, and press the keys you want, for example **Cmd + Shift + A**.

---

## 1. Meeting action items

### What it is

Every meeting note has an **Action items** section with checkboxes:

```markdown
## Action items

- [ ] Send the deck to Bob
- [ ] Book the review room
- [x] Share notes        ← already done
```

Over weeks of meetings, those unchecked boxes end up spread across dozens of notes. The **Meeting action items** panel gathers every unchecked box from every meeting note into one list, so nothing gets forgotten.

### How to open it

1. Press **Cmd + P**.
2. Type `action items`.
3. Choose **Open meeting action items**.

A panel titled **Open action items** opens in the **right sidebar** (the column on the right edge of the Obsidian window).

**Can't see the right sidebar?** Click the **sidebar icon** in the top-right corner of the window, or press **Cmd + P** and run **Toggle right sidebar**.

**Opening it next time:** after the first time, the panel stays in the right sidebar as a small tab with a **checklist icon** (☑ with lines) at the top of the sidebar, next to tabs like Backlinks and Outline. Click that icon to come back. Running the command again also brings it to the front.

### What you see

```
Open action items

Weekly Sync                     ← meeting title (click to open the note)
2026-10-06 10:00                ← when the meeting was
  ☐ Send the deck to Bob
  ☐ Book the review room

Design Review
2026-10-02 14:00
  ☐ Draft the Q4 plan
```

- Meetings are listed **newest first**.
- Only **unchecked** items appear. Checked items (`- [x]`) and empty checkboxes (`- [ ]` with nothing after it) are left out.
- Meetings with nothing left to do don't appear at all.
- If no meeting has an open item, the panel says **No open action items in your meeting notes.**

### How to use it

- **Tick a box** → the item is checked off *in its meeting note* (the `[ ]` becomes `[x]`) and disappears from the list. There is no separate copy to keep in sync.
- **Click a meeting title** → its note opens in the main area.
- **Add an item** → type `- [ ] something` in any meeting note. It appears in the panel within a second or so.

Any unchecked checkbox in a meeting note counts, not only the ones under **Action items**. A `- [ ] Ask about budget` line in your **Notes** section shows up too.

### How it works with recurring meetings

When the plugin creates the next note in a recurring series (for example next week's Weekly Sync), its **Agenda** reminds you of what is still open from last time:

```markdown
## Agenda

- Open items from [[last meeting]]:
  - Send the deck to Bob
- 
```

These reminders are plain bullets, not checkboxes, on purpose: each to-do stays in **one** place, the note where it was written. Tick it off in the panel (or in that earlier note) and it's done everywhere.

---

## 2. Meetings dashboard

### What it is

A table of all your meeting notes, with tabs for **Next 7 days**, **Last 7 days**, and **All meetings**, grouped by day. It is an Obsidian **Bases** file named `Meetings.base`, saved in your meeting-notes folder.

**Requires Obsidian 1.9 or later** (Bases was added in 1.9). Check your version under **Settings → About**.

### How to open it

1. Press **Cmd + P**.
2. Type `meetings dashboard`.
3. Choose **Open meetings dashboard**.

The first time, the plugin creates `Meetings.base` in your meeting-notes folder and opens it. After that you can also open it by clicking **Meetings.base** in the file list on the left, like any note.

### What you see

At the top left of the table is a **view menu** showing the current view's name. Click it to switch between:

| View | Shows | Columns |
|---|---|---|
| **Next 7 days** | Meetings starting from today through the next 7 days | Note, start, location, attendees, calendar |
| **Last 7 days** | Meetings from the past 7 days, up to now | Note, start, attendees, calendar |
| **All meetings** | Every meeting note, newest day first | Note, start, organizer, attendees, calendar, status |

Each view is grouped by day. **Click a note name** to open that meeting's note. The **status** column shows `cancelled` or `removed` for meetings that were cancelled or deleted from your calendar.

### Changing it

`Meetings.base` is yours to edit. Add or remove columns, change sorting, or add views from the toolbar above the table. See Obsidian's [Bases help](https://obsidian.md/help/bases). The plugin only creates the file if it's missing and never overwrites your changes. To get the original back, delete `Meetings.base` and run **Open meetings dashboard** again.

---

## Troubleshooting

**The action items panel is empty, but I have open items.**
- The items must be in notes the plugin created: notes with a `calendar_event_id` property, inside your **Note folder** (Settings → Calendar Note Integration → **Note folder**).
- The line must be a checkbox with text: `- [ ] Do the thing`. A plain bullet (`- Do the thing`) isn't a to-do.

**I can't find the panel after closing it.**
Run **Open meeting action items** again from the command palette (**Cmd + P**).

**`Meetings.base` opens as text, or nothing displays.**
Update Obsidian to 1.9 or later, and make sure **Settings → Core plugins → Bases** is turned on.

**A meeting is missing from the Meetings dashboard.**
Only meetings that have a note appear. Notes are created for meetings within **Hours in advance**. Use **Create note from calendar event** to make one for a meeting further out.
