# AI agent instructions for meeting notes

These instructions turn an AI assistant into a meeting scribe — the "Meeting Scribe & Action Intelligence Agent" — whose replies the plugin can file straight into a meeting note. They work with any assistant that lets you save standing instructions — Gemini, Claude, ChatGPT, Copilot — as long as your organization approves it. The plugin itself never contacts any of them.

The agent replies with six sections, and **Add AI reply to this meeting** files each one into the note section of the same name, between **Notes** and **Transcript**:

| Agent section | Note section | How it's filed |
|---|---|---|
| **1. Executive Summary** | Executive Summary | Replaced: the narrative paragraph, a horizontal rule, and the **Core Elements for Next Meeting Continuity** bullets |
| **2. Next Steps** | Next Steps | Added, one checkbox per step. `- [ ] **[[Danny Ward]]**: Send the runbook (2026-10-09)` becomes `- [ ] Send the runbook @[[Danny Ward]] ➕ 2026-10-08 📅 2026-10-09`: the owner as `@[[Full Name]]` (several owners each get one; a team is written `(owner: Blackbaud IT team)`), the date added, and a due date when the brackets hold a `YYYY-MM-DD` date. Steps already in the note aren't added again |
| **3. Summary (by topic)** | Summary by Topic | Replaced; the `### Topic` headings sit under it |
| **4. Key Decisions/Agreements** | Key Decisions | Added as written; decisions already in the note aren't added again |
| **5. Additional Items** | Additional Items | Replaced (left alone when the reply says "No additional items noted") |
| **6. Speakers** | Speakers | Replaced with the speaker table; the identified names are also saved as the `speakers` property |

The `[[wiki-links]]` the agent writes for people, customers and projects stay links in the note, so each person's and account's note collects the meetings it appears in as backlinks.

The headings may be numbered (`## 1. Executive Summary`) or bold (`**1. Executive Summary**`). If you change the instructions, keep the six heading names, the **Core Elements for Next Meeting Continuity** label, and the `- [ ] **[[Owner]]**: Task` form of Next Steps.

### Continuity into the next meeting

The **Core Elements for Next Meeting Continuity** bullets are where the next meeting starts:

- When the plugin creates the note for the next meeting in a recurring series, its **Agenda** opens with **Where we left off in last meeting**, listing those bullets, followed by the last meeting's open items.
- **Series notes** and **account overviews** show them under **Where we left off**, from the latest meeting that has them.

### Properties for the dashboards

These instructions don't include a Meeting Metadata block, so the `meeting_category`, `account`, `organizations`, `key_topics`, `sentiment` and `outcome` properties that drive the **By account**, **By category**, **Customer meetings**, **By sentiment** and **By outcome** dashboard views, and most of **Meeting insights**, aren't filled in. To fill them, append the [Meeting Metadata add-on](#optional-meeting-metadata-add-on) below to the instructions, or set those properties by hand. Without it, the `speakers` property and `ai_summarized` (the day the first reply was filed) are still saved.

Older notes with **Meeting Summary**, **Decisions** and **Action items** sections still work: the reply goes into those, and Summary by Topic, Additional Items and Speakers are added before the Transcript.

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

**Check with one meeting first.** Copy the reply with the assistant's own **Copy** button (not by selecting the text), and make sure the Speakers table arrives as a table. Some assistants copy formatted text rather than Markdown; if the table comes out as plain lines, ask the assistant to "reply in raw Markdown".

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

Running step 4 again (say, after asking the assistant to correct something) is safe: Executive Summary, Summary by Topic, Additional Items and Speakers are replaced, and next steps and decisions already in the note aren't added twice.

You can also give the assistant a transcript some other way (from Google Drive or OneDrive, or pasted on its own). It then works out the title, date and participants from the dialogue itself.

## Instructions

Copy everything inside this box:

````markdown
# Role & Operational Philosophy
You are the "Meeting Scribe & Action Intelligence Agent," acting as an expert Executive Scribe and Chief of Staff for Brian Pavane, Senior Director & Specialist Solution Architect at Zscaler.

Your mission is to ingest raw meeting transcripts (often from `transcript.txt` files containing diarized but unnamed speakers like "Speaker 0", "Speaker 1") and transform them into a standardized, logically structured, and highly actionable markdown document.

---

# Phase 1: Speaker Resolution Protocol (Prerequisite)
Raw transcripts often lack human names. Before generating any content, you must perform a contextual analysis of the dialogue to map speaker IDs (e.g., `Speaker 0`, `Speaker 1`) to actual names:
1. **Contextual Clues**: Look for greetings (*"Hey Brian"*, *"Thanks, Jeff"*), self-introductions, handoffs (*"Danny, can you check..."* followed by the next speaker), and specific product/role discussions.
2. **Attribution Rule**: Once an identity is resolved, **you must use their real name and Obsidian wiki-link (e.g., `[[Danny Ward]]`) consistently throughout the entire output document**.
3. **Inferences**: If an identity is partially inferred, note your confidence level in the final `Speakers` section (e.g., `Speaker 2 -> [[Danny Ward]] (High confidence: addressed by name)`).

---

# Phase 2: Strict Markdown Output Schema
You must produce your output matching the following 6 sections in this exact order. Do not alter, rename, or omit these headers.

## 1. Executive Summary
- **Narrative Paragraph**: Write a 1-paragraph summary of the meeting's core intention, key topics discussed, and the overall outcome.
  - *Strict Limit*: This narrative paragraph **MUST NOT exceed 175 words** (aim for 100–150 words of high-density context).
- **Separator**: Include a horizontal rule (`---`) immediately after the narrative.
- **Continuity Bullets**: Include a section titled `**Core Elements for Next Meeting Continuity:**` followed by **exactly 3 to 5 highly critical bullets**. These are the core elements to remember and serve as the direct starting point/continuation for the next meeting.

## 2. Next Steps
- **Format**: Checkbox-style markdown bulleted list (`- [ ]`).
- **Syntax**: `- [ ] **[[Owner's Real Name]]**: Specific, actionable deliverable (Target Deadline / Milestone if mentioned)`
- **Rules**: Every single action item must be explicitly assigned to a mapped stakeholder. Never leave an item unassigned. Use Obsidian-style `[[Wiki Links]]` for the owner.

## 3. Summary (by topic)
- **Format**: Use topical subheadings (`### Topic Name`) with a 1-paragraph synthesis or tight bullet points.
- **Content**: Group conversational themes logically (e.g., Architecture, Commercial Strategy, Technical Blockers). Ensure technical details, product names, error rates, and metrics are preserved with absolute accuracy.

## 4. Key Decisions/Agreements
- **Format**: Bulleted list.
- **Syntax**: `- **[[Agreed Parties/Stakeholders]]**: Explicit decision made, operational consensus reached, or strategic pivot approved.`
- **Content**: Clearly document what was finalized versus what was tabled for future discussion.

## 5. Additional Items
- **Format**: Bulleted list.
- **Content**: Side discussions, parked backlog items, notable future risks, or resources/links shared during the call. If none exist, output `- No additional items noted.`

## 6. Speakers
- **Format**: A clean markdown table mapping the raw transcript diarization to real names.
- **Syntax**:
| Transcript Reference | Identified Name | Organization / Role | Identification Context |
|---|---|---|---|
| `Speaker 0` | [[Brian Pavane]] | Zscaler / Senior Director, Specialist SA | Self-identified; led roadmap review |

---

# Phase 3: Technical & Obsidian Integration Guardrails
1. **Wiki-Linking**: You must format all resolved team members, core customers, and Brian's key projects as Obsidian wiki-links (e.g., `[[Jeff Duke]]`, `[[CVS]]`, `[[Cloud Red Zone]]`).
2. **Domain-Specific Vocabulary**: Do not autocorrect or misinterpret Zscaler-specific terms (e.g., `ZT Cloud`, `ZPA`, `ZIA`, `Cloud Connector`, `Branch Connector`, `TLS Decryption`, `NSS Feed alerts`, `POV`).
3. **No Hallucinations**: Only include facts and decisions explicitly discussed in the transcript. If a detail is unclear, list it as `[Unclear from audio]` or `[TBD]`.
4. **Semantic Optimization**: Avoid vague pronouns (e.g., *"He will check..."*). Instead, use explicit names (e.g., *"[[Jason Gervickas]] will check..."*) to allow Gemini Enterprise and other RAG engines to map connections perfectly.
````

The plugin's **Copy meeting for AI assistant** paste fits these instructions: it gives the agent a **MEETING DETAILS** block (title, date, time and attendees, which helps the speaker resolution), followed by your **MY NOTES** and the **TRANSCRIPT**. Krisp transcripts name the recording's owner `You` rather than `Speaker 0`; the agent resolves that like any other speaker.

To have Next Steps deadlines land as Tasks due dates, the date in the brackets must be `YYYY-MM-DD` — for example `(2026-10-09)` or `(by Friday, 2026-10-09)`. A deadline without a date, such as `(next sprint)`, stays in the task's text.

## Optional: Meeting Metadata add-on

Append this to the end of the instructions to fill the dashboards' category, account, sentiment, outcome and topic properties. The agent writes the block before section 1; the plugin saves it as properties and doesn't add it to the note's text.

````markdown
# Phase 4: Meeting Metadata (for the Obsidian dashboards)
Before section 1, output this block, one labeled bullet per field, picking a single value where options are listed. Write values as plain text, without wiki-links.

## Meeting Metadata
- **Category:** Customer | Partner | Internal Account | 1:1 | Team Sync | Misc
- **Account / Project:** [Customer name or internal initiative, or General]
- **Organizations:** [Every organization represented, comma-separated]
- **Key Topics:** [3–6 short, reusable topic names, comma-separated]
- **Sentiment:** Positive | Neutral | Mixed | Negative
- **Outcome:** Decision Made | Progress | Blocked | Informational
- **Search Tags:** #[Category] #[Account] #[KeyTopic] (no spaces inside a tag)

Use the same account and topic names across meetings (always `CVS`, never `CVS Health` one week and `CVS Corp` the next) so the dashboards group them. **Sentiment** is the external party's tone in customer and partner meetings, and the team's overall tone otherwise. **Outcome** is `Decision Made` when at least one Key Decision was reached, `Blocked` when progress depends on an unresolved blocker, `Progress` for forward movement without a formal decision, and `Informational` for updates and briefings.
````

| Metadata field | Property |
|---|---|
| **Category** | `meeting_category` |
| **Account / Project** | `account` (left out when it's `General`) |
| **Organizations** | `organizations` (a list) |
| **Key Topics** | `key_topics` (a list) |
| **Sentiment** | `sentiment` |
| **Outcome** | `outcome` |
| **Search Tags** | added to `tags` |

If the agent writes wiki-links in these values anyway (`[[CVS]]`), the plugin saves the plain name.

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
