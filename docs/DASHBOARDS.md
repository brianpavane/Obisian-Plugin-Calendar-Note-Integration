# Dashboards — a step-by-step guide

The plugin gives you three dashboards. A dashboard is a page that pulls information together and shows it in one place, so you don't have to open each note or flip to Calendar.app.

| Dashboard | What it answers | Where it appears |
|---|---|---|
| **Today's meetings** | "What's on today, and how do I get into the next one?" | A panel in the **right sidebar** |
| **Meeting action items** | "What did I promise to do, in any meeting? What's overdue? What does Bob owe me?" | A panel in the **right sidebar** |
| **Meetings dashboard** | "What meetings do I have coming up, and what did I have last week?" | A table that opens in the **main editor area**, like a note |

**Today's meetings** reads your Apple Calendar. The other two are built from the meeting notes the plugin created (notes with a `calendar_event_id` property, wherever in the vault you've filed them). None of them ever change your calendar.

---

## The quickest way: the ribbon buttons

The **ribbon** is the thin strip of icons down the far-left edge of the Obsidian window. The plugin adds a button there for each dashboard:

| Button | Opens |
|---|---|
| **Calendar-with-clock** icon | **Today's meetings** |
| **Checklist** icon (☑ with lines) | **Meeting action items** |
| **Dashboard** icon (four squares) | **Meetings dashboard** |

(The plain **calendar** icon next to them is the older "create a note from an event" button.)

Hover over a button and its name appears. Click it to open the dashboard.

**Don't see the buttons?** Make sure the plugin is updated to 6.11.0 or later. If the ribbon itself is hidden, turn it back on under **Settings → Appearance → Show ribbon**. If a button is missing, right-click the ribbon and tick it in the list.

## The other way: the command palette

You can also open every dashboard with a *command*. Obsidian runs commands from the **command palette**:

1. Press **Cmd + P** (or click the **>_** "Open command palette" icon in the left ribbon).
2. A search box appears. Start typing the command's name, for example `action items`.
3. Click the matching line, or press **Return**.

In the palette, every command from this plugin starts with **Calendar Note Integration - Apple-iCal-Google:**, so typing `calendar` lists them all.

> **Tip — give it a shortcut.** Open **Settings → Hotkeys**, search for `today's meetings`, `action items`, or `meetings dashboard`, click the **+** next to the command, and press the keys you want, for example **Cmd + Shift + A**.

---

## 1. Today's meetings

### What it is

A list of every meeting on today's calendar, from first to last, with a button to open its note and a button to join. It's the "what's my day look like?" view, and the fastest way into your next call.

### How to open it

Click the **calendar-with-clock** button in the left ribbon.

Or: press **Cmd + P**, type `today`, and choose **Open today's meetings**.

It opens in the **right sidebar**. Like the action items panel, it stays there as a tab (with the calendar-with-clock icon) until you close it.

### What you see

```
‹ Tuesday, October 6 ›        [New note] [Refresh]

9:00 AM – 9:15 AM                        ← faded: already over
Standup
[Open note]

11:00 AM – 12:00 PM  [Now]               ← highlighted: happening now
Design Review
[Open note] [Join]

3:00 PM – 4:00 PM
Planning
[Create note] [Join]
```

- **Faded** meetings are over. The meeting happening **now** has a coloured bar and a **Now** badge.
- **Open note** opens the meeting's note. If the note doesn't exist yet, the button says **Create note** and makes it, using your template, with the link to the previous meeting and its open items.
- **Join** opens the Zoom / Meet / Teams / Webex link. It appears only when the meeting has one, and disappears once the meeting is over.
- Clicking a meeting's **title** does the same as Open note / Create note.
- All-day events, cancelled meetings, and meetings you declined are left out, just as they are for note creation.

### Other days

Click **‹** beside the date to see the day before, or **›** for the day after. Keep clicking to go further. On a past day every meeting is faded; you can still open or create its note. A **Today** button appears while you're on another day; click it to come back.

### Notes for meetings that aren't on your calendar

Click **New note**, type a title (for example `Hallway chat with Bob`), and press **Enter**. The plugin creates a note from your template, just like a calendar meeting's note, dated on the day the panel is showing and starting at the current time (rounded down to the quarter hour). Fill in who was there and what was said as usual. Because the meeting isn't on your calendar, it doesn't appear in the panel's list, and syncing never changes or flags the note.

### Keeping it current

The list re-reads your calendar every 5 minutes, and the Now / faded markers update every minute. Click **Refresh** to re-read it straight away, for example after adding a meeting in Calendar.app.

---

## 2. Meeting action items

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

Click the **checklist** button in the left ribbon.

Or: press **Cmd + P**, type `action items`, and choose **Open meeting action items**.

A panel titled **Open action items** opens in the **right sidebar** (the column on the right edge of the Obsidian window).

**Can't see the right sidebar?** Click the **sidebar icon** in the top-right corner of the window, or press **Cmd + P** and run **Toggle right sidebar**.

**Opening it next time:** after the first time, the panel stays in the right sidebar as a small tab with a **checklist icon** (☑ with lines) at the top of the sidebar, next to tabs like Backlinks and Outline. Click that icon to come back. Clicking the ribbon button again also brings it to the front.

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

### Who owns it, and when it's due

You can add two optional tags to any action item:

| To say… | Type… | Example |
|---|---|---|
| Who owns it | `@` and a name | `- [ ] Send the deck @Bob` |
| Who owns it (name with spaces) | `@` and a link | `- [ ] Send the deck @[[Bob Jones]]` |
| When it's due | `📅` and a date (year-month-day) | `- [ ] Send the deck @Bob 📅 2026-10-10` |
| When it's due (easier to type) | `[due:: ` date `]` | `- [ ] Send the deck @Bob [due:: 2026-10-10]` |

The 📅 and `[due:: ]` formats are the ones the **Tasks** community plugin uses, so if you use Tasks it understands these dates too. (To type 📅 on a Mac, press **Ctrl + Cmd + Space** and search for "calendar".)

In the panel, a due date shows under the item, in **red** once the date has passed.

### Grouping: by meeting, by person, or by due date

At the top of the panel is a menu, set to **By meeting** at first. Change it to see the same items another way:

| Choice | Groups | Good for |
|---|---|---|
| **By meeting** | One group per meeting, newest first | "What came out of yesterday's review?" |
| **By person** | One group per `@owner`, A–Z; items without an owner go under **Unassigned** | "What does Bob owe me?" before a 1:1 |
| **By due date** | **Overdue**, **Today**, **Next 7 days**, **Later**, **No due date** | "What's late?" at the start of the day |

When grouped by person or due date, each item shows which meeting it came from. Click that name to open the meeting's note. The panel remembers your choice.

---

## 3. Meetings dashboard

### What it is

A table of all your meeting notes, with tabs for **Next 7 days**, **Last 7 days**, **By account**, **By category** and **All meetings**. It is an Obsidian **Bases** file named `Meetings.base`, saved in your meeting-notes folder.

**Requires Obsidian 1.9 or later** (Bases was added in 1.9). Check your version under **Settings → About**.

### How to open it

Click the **dashboard** button (four squares) in the left ribbon.

Or: press **Cmd + P**, type `meetings dashboard`, and choose **Open meetings dashboard**.

The first time, the plugin creates `Meetings.base` in your meeting-notes folder and opens it. After that you can also open it by clicking **Meetings.base** in the file list on the left, like any note.

### What you see

At the top left of the table is a **view menu** showing the current view's name. Click it to switch between:

| View | Shows | Columns |
|---|---|---|
| **Next 7 days** | Meetings starting from today through the next 7 days | Note, start, location, attendees, calendar |
| **Last 7 days** | Meetings from the past 7 days, up to now | Note, start, attendees, calendar |
| **By account** | Meetings with an `account` property, grouped by account | Note, start, category, attendees |
| **By category** | Meetings with a `meeting_category` property, grouped by category | Note, start, account, attendees |
| **All meetings** | Every meeting note, newest day first | Note, start, organizer, attendees, calendar, status |

The day views are grouped by day. **By account** and **By category** fill in as you add AI replies that include a Category and Primary Account / Project (see [AI agent instructions](AGENT_INSTRUCTIONS.md)); you can also type the `account` and `meeting_category` properties yourself.

> **Already have `Meetings.base`?** The plugin never changes your copy, so it won't get the two new views by itself. Delete `Meetings.base` and run **Open meetings dashboard** to get a fresh one (any changes you made to it are lost), or add the views yourself. **Click a note name** to open that meeting's note. The **status** column shows `cancelled` or `removed` for meetings that were cancelled or deleted from your calendar.

### Changing it

`Meetings.base` is yours to edit. Add or remove columns, change sorting, or add views from the toolbar above the table. See Obsidian's [Bases help](https://obsidian.md/help/bases). The plugin only creates the file if it's missing and never overwrites your changes. To get the original back, delete `Meetings.base` and run **Open meetings dashboard** again.

---

## Troubleshooting

**The action items panel is empty, but I have open items.**
- The items must be in notes the plugin created: notes with a `calendar_event_id` property. They can be in any folder.
- The line must be a checkbox with text: `- [ ] Do the thing`. A plain bullet (`- Do the thing`) isn't a to-do.

**Today's meetings says "Couldn't read your calendar."**
The plugin couldn't reach Apple Calendar. Open **Settings → Calendar Note Integration** and click **Test connection**; see the README's Troubleshooting section for the usual fixes (Calendar access permission).

**An item has a date, but it isn't red / isn't under Overdue.**
The date must be written year-month-day with two-digit month and day, e.g. `📅 2026-10-05`, not `📅 10/5`.

**I can't find a panel after closing it.**
Click its button in the left ribbon (calendar-with-clock for Today, checklist for action items), or run **Open today's meetings** / **Open meeting action items** from the command palette (**Cmd + P**).

**`Meetings.base` opens as text, or nothing displays.**
Update Obsidian to 1.9 or later, and make sure **Settings → Core plugins → Bases** is turned on.

**A meeting is missing from the Meetings dashboard.**
Only meetings that have a note appear. Notes are created for meetings within **Hours in advance**. Use **Create note from calendar event** to make one for a meeting further out.
