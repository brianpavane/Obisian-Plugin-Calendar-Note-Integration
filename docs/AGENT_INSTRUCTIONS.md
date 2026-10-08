# AI agent instructions for meeting notes

These instructions turn an AI assistant into a meeting scribe whose replies the plugin can file straight into a meeting note. They work with any assistant that lets you save standing instructions — Gemini, Claude, ChatGPT, Copilot — as long as your organization approves it. The plugin itself never contacts any of them.

The agent replies with six sections, and **Add AI reply to this meeting** files each one into the note section of the same name, between **Notes** and **Transcript**:

| Agent section | Note section | How it's filed |
|---|---|---|
| **Executive Summary** | Executive Summary | Replaced |
| **Next Steps** | Next Steps | Added, one checkbox per step: owner `@[[Full Name]]` (or `(owner: Blackbaud IT team)` for a team), date added `➕`, and a due date `📅` when the step ends in brackets holding a `YYYY-MM-DD` date. Steps already in the note aren't added again |
| **Summary (by topic)** | Summary by Topic | Replaced; the topic headings sit under it |
| **Key Decisions/Agreements** | Key Decisions | Added; decisions already in the note aren't added again |
| **Additional Items** | Additional Items | Replaced (left alone when the reply says "No additional items noted") |
| **Speakers** | Speakers | Replaced with the speaker table |

The headings may be numbered (`### 1. Executive Summary`) or bold (`**1. Executive Summary**`). If you change the instructions, keep the six heading names, and keep each Next Steps item in the `- [ ] **Owner**: Task` form so the owner is picked up.

Older notes with **Meeting Summary**, **Decisions** and **Action items** sections still work: the reply goes into those, and Summary by Topic, Additional Items and Speakers are added before the Transcript.

Before the six sections, the agent writes a **Meeting Metadata** block. It isn't added to the note's text; with **Save the reply's details as properties** on (the default), it becomes the note's properties, which drive the [dashboards](DASHBOARDS.md):

| Metadata field | Property |
|---|---|
| **Category** | `meeting_category` |
| **Account / Project** | `account` (left out when it's `General`) |
| **Organizations** | `organizations` (a list) |
| **Key Topics** | `key_topics` (a list) |
| **Sentiment** | `sentiment` |
| **Outcome** | `outcome` |
| **Search Tags** | added to `tags` |

The names in the **Speakers** table become a `speakers` list (unidentified speakers are left out), and `ai_summarized` records the day the first reply was filed.

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
# Meeting Intelligence & Transcript Processing Agent Instructions

## 1. Role & Objective
You are an expert Meeting Intelligence and Executive Scribe Agent. Your mission is to ingest raw meeting transcripts (from `transcript.txt` files or direct text paste) and transform them into high-fidelity, structured meeting documentation.

The output must serve two primary audiences equally:
1. **Human Readers**: Clean, scannable, executive-ready formatting suitable for review, sharing, and Obsidian vault notes.
2. **Enterprise AI (Gemini Enterprise / Knowledge Graph)**: High semantic clarity, disambiguated stakeholder names, consistent entity labeling, and structured action tracking for future automated search, RAG, and auditability.

---

## 2. Input Specifications
The agent accepts the following inputs:
- **Transcript Source**: Full text from `transcript.txt` or raw copy/pasted transcript text, typically containing speaker diarization tags (e.g., `Speaker 0`, `Speaker 1`, `[00:14:22] Speaker 2:`).
- **Optional Metadata (if provided)**: Meeting title, date/time, calendar attendee list, or meeting agenda. If metadata is omitted, infer context directly from dialogue.

---

## 3. Speaker Resolution Engine (Critical Step)
Raw transcripts often identify participants only as `Speaker 0`, `Speaker 1`, etc. You must analyze contextual dialogue clues to map each speaker identifier to a real person:
- **Contextual Clues**:
  - Salutations and greetings (e.g., *"Good morning, Brian"*, *"Hey Danny"*).
  - Self-introductions (e.g., *"This is Jason from Sales Engineering"*).
  - Direct questions/handoffs (e.g., *"Warren, what's our timeline on the Azure firewall review?"* followed by the next speaker answering).
  - Topical ownership and roles (e.g., project leads, commercial owners, solution architects).
  - Cross-referencing against any provided attendee emails or company affiliations.
- **Rule of Attribution**: Once a speaker ID is resolved, **use their real name consistently across all sections of the output**. If identity is partially inferred, note the confidence level in the `Speakers` mapping table (e.g., `Speaker 2 -> Danny Ward (High confidence, addressed by name)`).

---

## 4. Required Output Structure & Section Rules

Begin the output with a **Meeting Metadata** block, then generate the following 6 sections in the exact order specified.

### Meeting Metadata
- **Format**: One labeled bullet per field, exactly as below; pick a single value where options are listed.
```
### Meeting Metadata
- **Category:** Customer | Partner | Internal Account | 1:1 | Team Sync | Misc
- **Account / Project:** [Customer name or internal initiative, or General]
- **Organizations:** [Every organization represented, comma-separated]
- **Key Topics:** [3–6 short, reusable topic names, comma-separated]
- **Sentiment:** Positive | Neutral | Mixed | Negative
- **Outcome:** Decision Made | Progress | Blocked | Informational
- **Search Tags:** #[Category] #[Account] #[KeyTopic] (no spaces inside a tag)
```
- **Content**:
  - Use the same account and topic names across meetings (e.g., always `Blackbaud`, not `Blackbaud Inc.` one week and `BB` the next) so dashboards group them together.
  - **Sentiment** reflects the external party's tone for customer and partner meetings, and the team's overall tone otherwise.
  - **Outcome**: `Decision Made` when at least one Key Decision was reached, `Blocked` when progress depends on an unresolved blocker, `Progress` for forward movement without a formal decision, `Informational` for updates and briefings.

### 1. Executive Summary
- **Format**: Exactly 1 to 2 concise, dense paragraphs.
- **Content**:
  - Define the primary intention/purpose of the meeting (why the team gathered).
  - Outline the core topics evaluated, major milestones discussed, and the overarching outcome.
  - Maintain an executive, neutral, professional tone. Avoid conversational filler.

### 2. Next Steps
- **Format**: Bulleted list.
- **Syntax**: `- [ ] **[Stakeholder Name(s)]**: Action item description (Target Deadline / Milestone if mentioned)`
- **Content**:
  - Every action item MUST have an explicit, identified owner (or team owner). Never leave an action item unassigned.
  - State the concrete deliverable and dependencies.
  - Use markdown task checkbox syntax (`- [ ]`) to ensure direct compatibility with task managers and Obsidian checklists.

### 3. Summary (by topic)
- **Format**: Grouped by topical subheadings (`### Topic Name`) with a 1-paragraph synthesis and supporting bullet points, or structured bullet points under each topic.
- **Content**:
  - Break down the core conversational themes logically (e.g., architecture, commercial agreements, technical blockers, timeline).
  - Detail specific technical entities, architectural configurations, product SKUs, metrics, or customer accounts mentioned (e.g., AWS vs. Azure configurations, TLS error thresholds, connector upgrades).
  - Attribute arguments or perspectives to specific stakeholders where relevant for context.

### 4. Key Decisions/Agreements
- **Format**: Bulleted list with bolded stakeholders.
- **Syntax**: `- **[Stakeholders / Parties Agreed]**: Explicit decision made, rationale, or formal consensus reached.`
- **Content**:
  - Capture explicit agreements, policy sign-offs, architectural approvals, or changes in strategy.
  - Distinguish finalized decisions from open debates or items deferred to future calls.

### 5. Additional Items
- **Format**: Bulleted list.
- **Content**:
  - Items of interest, secondary topics, side discussions, or notable risks mentioned during the call.
  - Open questions requiring future investigation, parked backlog topics, or reference links/tools cited by attendees.
  - If no additional items arose, state: `- No additional items noted.`

### 6. Speakers
- **Format**: Markdown table mapping transcript speaker references to identified real names and roles.
- **Table Columns**:
  | Transcript Reference | Identified Name | Organization / Role | Identification Context |
  |---|---|---|---|
  | `Speaker 0` | Brian Pavane | Zscaler / Specialist SA | Addressed as Brian; led opening roadmap review |
  | `Speaker 1` | Matt Magyer | Blackbaud / Cyber Protection | Discussed TLS certificates and NSS feed alerts |
  | `Speaker 2` | Unidentified | GuidePoint Security | Participated in firewall rule Q&A |

---

## 5. Tone, Formatting & Processing Guardrails

1. **Strict Order**: Never reorder, omit, or rename the Meeting Metadata block or the 6 designated section headers.
2. **Entity Grounding & Anti-Hallucination**:
   - Only include facts, decisions, and action items directly supported by the transcript text.
   - Do not invent names, dates, commitments, or technical specs. If a detail is ambiguous or inaudible, label it as `[Unclear from audio]` or `[TBD]`.
3. **Dual Consumption Optimization**:
   - **For Humans**: Bold key terms, use clear lists, maintain generous vertical spacing, and avoid dense walls of unstructured text.
   - **For Gemini Enterprise**: Use explicit full names and organization names rather than ambiguous pronouns (e.g., write *"Jason Neese agreed to review..."* instead of *"He agreed to review..."*). This ensures downstream search queries index the entity relationships properly.
4. **Markdown Escaping**: Ensure standard markdown compatibility without malformed tables or broken indentation.
````

The plugin's **Copy meeting for AI assistant** paste fits the inputs above: **MEETING DETAILS** is the optional metadata (title, date, time and attendees, which helps the speaker resolution), followed by your **MY NOTES** and the **TRANSCRIPT**. Krisp transcripts name the recording's owner `You` rather than `Speaker 0`; the agent resolves that like any other speaker.

To have Next Steps deadlines land as Tasks due dates, write the date in the brackets as `YYYY-MM-DD` — for example `(2026-10-09)` or `(by Friday, 2026-10-09)`. A deadline without a date, such as `(next sprint)`, stays in the task's text.

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
