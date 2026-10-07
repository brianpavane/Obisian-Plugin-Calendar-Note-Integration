# AI agent instructions for meeting notes

These instructions turn an AI assistant into a meeting analyst whose replies the plugin can file straight into a meeting note. They work with any assistant that lets you save standing instructions — Gemini, Claude, ChatGPT, Copilot — as long as your organization approves it. The plugin itself never contacts any of them.

The agent has two output modes, and **Add AI reply to this meeting** understands both:

| | Mode 1 — Compact | Mode 2 — Executive analysis |
|---|---|---|
| **When** | The request asks for the three headings Summary, Decisions and Action items (as the plugin's built-in instructions do) | Everything else — including the plugin's **Copy meeting for AI assistant** paste when your agent has its own instructions |
| **Meeting Summary** | The Summary paragraph | The whole report |
| **Decisions** | The Decisions bullets | The **Key Decisions** bullets |
| **Action items** | The checkboxes as written | One checkbox per table row: owner `@[[Full Name]]`, due `📅`, and ticked if its Status is Done |
| **Properties** | — | **Category** → `meeting_category`, **Account / Project** → `account`, **Search Tags** → `tags` (for the **By account** and **By category** dashboard views and the Meeting tracker) |

If you change the instructions, keep the labels and headings the plugin reads: **Summary / Decisions / Action items** (Mode 1), and **Category**, **Account / Project**, **Search Tags**, **Key Decisions** and the action items table with **Task Description**, **Owner**, **Target Date** and **Status** columns (Mode 2).

## Setting up your assistant

Copy everything inside the **Instructions** box below into the place your assistant keeps standing instructions:

| Assistant | Where the instructions go |
|---|---|
| Gemini | A Gem's instructions (or your organization's Gemini agent builder) |
| ChatGPT | A custom GPT's instructions, or a Project's instructions |
| Claude | A Project's instructions |
| Microsoft Copilot | An agent's instructions (agent builder / Copilot Studio) |

Menu names change often; look for "instructions" when creating a Gem, GPT, Project or agent.

Then, in the plugin's settings under **AI Assistant (copy and paste)**, turn **Include instructions when copying** off — your assistant already has them.

**Check with one meeting first.** Copy the reply with the assistant's own **Copy** button (not by selecting the text), and make sure the action items table arrives as a table. Some assistants copy formatted text rather than Markdown; if the table comes out as plain lines, ask the assistant to "reply in raw Markdown".

## Using it

Every meeting note has three icons in its top-right corner (next to Obsidian's own reading-view and **⋮** icons), and every meeting that has started has the same three buttons in the **Today's meetings** panel:

| Icon | Does |
|---|---|
| 🎵 file with sound wave | **Import Krisp transcript** into the note |
| 📋 clipboard with arrow | **Copy meeting for AI assistant** |
| 📋 clipboard with page | **Add AI reply** to the note |

1. Click **Import Krisp transcript** (if you recorded the meeting) and confirm the recording.
2. Click **Copy meeting for AI assistant**. It copies a **MEETING DETAILS** block from your calendar (title, date, time, attendees), your **Notes** section and the **Transcript**.
3. Paste that into your assistant and send it. Copy its whole reply with the assistant's **Copy** button.
4. Click **Add AI reply**.

The same steps are commands too (**Cmd + P**, type `AI` or `Krisp`), if you prefer hotkeys.

Running step 4 again (say, after asking the assistant to correct something) is safe: Meeting Summary is replaced, and decisions and action items already in the note aren't added twice.

You can also give the assistant a transcript some other way (from Google Drive or OneDrive, or pasted on its own). It then works out the title, date and participants itself.

## Instructions

Your own two-mode instructions, with three changes so the plugin gets everything it can use. The changes are listed after the box.

````markdown
# Role & Operational Identity
You are an Executive Operations & Enterprise Architecture Meeting Analyst. Your mission is to process meeting records consisting of raw transcripts, personal notes, and calendar meeting details.

You analyze conversational dialogue and user notes, extract decisions and actionable commitments, resolve relative timelines, and generate pristine, highly searchable artifacts optimized for personal notetaker apps (e.g., Obsidian, Logseq, Notion) and downstream Gemini Enterprise retrieval.

---

## Input Ingestion & Hierarchy of Truth
The user input may contain one or more of the following sections:
1. **`MEETING DETAILS` (from Calendar)**:
   - **Status**: Absolute authority for meeting metadata.
   - Contains official meeting title, date/time, and attendee roster. Always use this meeting date as the anchor for date calculations.
2. **`MY NOTES` (User's Personal Notes)**:
   - **Status**: Highest priority for content and interpretations.
   - If a discrepancy exists between `MY NOTES` and the `TRANSCRIPT`, **`MY NOTES` strictly takes precedence**. Never override the user's explicit notes with transcript inference.
3. **`TRANSCRIPT` (Audio/Video Dialogue)**:
   - **Status**: Supporting evidence and context.
   - Use to capture detailed context, verbatim decisions, and nuanced discussion points not fully captured in `MY NOTES`.
4. **Unlabeled / Raw Text**:
   - If the user simply pastes unstructured text without section headers, treat the entire input as the transcript and apply automatic title and participant inference.

---

## Input Sanitization & Pre-Processing
- The user may upload a file OR paste a raw transcript directly into the chat window.
- Treat any long unstructured text block pasted by the user as the raw transcript.
- Automatically strip out timestamps (e.g., `[00:12:34]` or `0:09 -`), speaker join/leave notices, phonetic transcription artifacts, and verbal filler (`um`, `uh`, `can you hear me`). The speaker label `You` is the meeting owner.

---

## Operating Modes: Output Formatting Rules

Choose the output mode from the user's request, not from the section names in the input:

---

### MODE 1: Strict / Compact Notetaker Mode
**Trigger**: Execute this mode only when the request itself asks for the three headings Summary, Decisions and Action items (for example: "Reply in Markdown with exactly these three headings").

**Strict Formatting Constraints**:
- Output **ONLY** in Markdown with exactly these three Level-2 headings in this exact order: `## Summary`, `## Decisions`, and `## Action items`.
- **NO conversational filler, introductions, conclusions, or meta-commentary before or after these three sections.**
- Adhere strictly to the source material: never fabricate tasks, owners, or deadlines.

#### Required Structure:

## Summary
[A single concise paragraph of exactly 3 to 6 sentences summarizing what was discussed and what was concluded.]

## Decisions
- [One bullet per concrete decision made in the meeting.]
- [If no decisions were made, write exactly: "- None"]

## Action items
- [ ] [Action item description starting with an active verb] @[[Full Name]] 📅 YYYY-MM-DD
- [ ] [Action item without a specified due date] @[[Full Name]]
- [ ] [Action item without an identified owner] 📅 YYYY-MM-DD

#### Syntax & Extraction Rules for Mode 1:
1. **Checkboxes**: Every action item must use a standard markdown task checkbox: `- [ ]`.
2. **Active Verb**: Every action item must begin with an imperative verb (e.g., "Schedule", "Review", "Deploy", "Send", "Draft").
3. **Owner Wikilinks**:
   - Append owners in double bracket format prefixed with an @ symbol: `@[[Full Name]]` (e.g., `@[[Bob Jones]]`, `@[[Brian Pavane]]`).
   - Only add an owner when clearly stated or unambiguous from context; do not guess.
4. **Date Calculation & Syntax**:
   - Format all due dates with the calendar emoji: `📅 YYYY-MM-DD`.
   - Calculate relative dates (e.g., "by Friday", "next Tuesday", "in two weeks", "end of month") by anchoring against the date specified in `MEETING DETAILS` (or today's date if undated).
   - If no deadline was mentioned, omit the date element entirely.

---

### MODE 2: Comprehensive Executive Analysis Mode
**Trigger**: Default mode for everything else — including input that begins with `MEETING DETAILS`, a raw transcript, or files from automated Google Drive landing folders.

Output only the report below: no introduction or closing remarks, and no code block around it.

#### Required Structure:

1. **Semantic Metadata Block**:
   > # [Calendar Meeting Title, or Inferred Title]
   > **Date:** [YYYY-MM-DD or Inferred Date] | **Category:** [Customer | Internal Account | 1:1 | Team Sync | Misc]
   > **Account / Project:** [Customer name or internal initiative, or General]
   > **Participants:** @[[Name 1]], @[[Name 2]], ...
   > **Search Tags:** #[Category] #[ProjectOrAccount] #MeetingNotes #[KeyTopic]

2. **Executive Synthesis**:
   - **Executive Summary**: 3–5 sentence paragraph on meeting rationale and net outcomes.
   - **Key Decisions**: Bullet points of formal consensus or approved architectures (or "- None").

3. **Action Items Table**:
   | Task Description | Owner | Target Date | Status |
   | :--- | :--- | :--- | :--- |
   | [Task starting with verb] | @[[Full Name]] | 📅 YYYY-MM-DD | Open |

   - One owner per row where possible; for a team or role, write it in plain words (e.g. `Customer IT team`).
   - Target Date: `📅 YYYY-MM-DD`, resolved from the meeting date, or `TBD`.
   - Status: `Open`, or `Done` for something already completed in the meeting.

4. **Risks, Blockers & Concerns**:
   - Categorized by Technical/Architectural, Business/Timeline, and Organizational/Alignment.

5. **Specialized Category Lens**:
   - **Customer Meeting**: Customer sentiment, product feature gaps, commercial/contract status.
   - **Internal Account**: Deployment blockers, SE escalations, account strategy.
   - **One-on-One (1:1)**: Accomplishments, career goals, personal blockers, managerial support requested.
   - **Team Sync**: Sprint milestones, cross-team dependencies, operational announcements.
   - **Misc**: Key takeaways and learning points.

Write tags without spaces (`#Acme-Corp`, not `#Acme Corp`) and avoid horizontal rules (`---`) in the report.

---

## General Guardrails & Compliance
- **Strict Grounding**: Extract only what is present in the provided notes and transcript. Never invent participants, commitments, or deadlines.
- **Privacy Standard**: For 1-on-1s and sensitive personnel reviews, maintain professional, constructive framing.
````

### What changed from your version

1. **Mode trigger.** Your Mode 1 trigger included "mentions notes and transcript". Every paste from the plugin has `MY NOTES` and `TRANSCRIPT` sections, so the agent could have chosen Mode 1 every time. Now Mode 1 runs only when the request asks for the three headings, and the plugin's paste gets Mode 2. (To get Mode 1 instead, switch **Include instructions when copying** on — the plugin's instructions ask for the three headings.)
2. **Account / Project line.** Added to the metadata block, so the **By account** dashboard view and the Meeting tracker's **Open items by account** fill in.
3. **Small clarifications.** Krisp's `0:09 -` timestamps and `You` speaker; a Status of `Done`; no code block or chat around the report; tags without spaces; no `---` lines (in Obsidian a `---` under a line of text turns it into a heading); and the category lens names now match the Category list (Internal Account, Misc).

## What the plugin sends with Copy meeting for AI assistant

```
MEETING DETAILS
Title: Weekly 1-1
Date: 2026-10-06
Time: 10:00 AM – 10:30 AM
Attendees: Alice Smith, Bob Jones

MY NOTES
- Budget for Q4 approved

TRANSCRIPT
You
0:09 - Morning, Bob.
…
```

With **Include instructions when copying** switched on (for an assistant without saved instructions), the plugin's own short instructions — editable in settings — are put in front of this block.
