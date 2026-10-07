import test from "node:test";
import assert from "node:assert/strict";
import { actionLine, applyReply, copyText, DEFAULT_INSTRUCTIONS, parseReply } from "../src/assistant";
import { builtInTemplate } from "../src/noteCreator";

const meeting = { title: "Design Review", date: "2026-10-06", time: "11:00 AM – 12:00 PM", attendees: ["Alice Smith", "Bob Jones"] };
const blankNote = `---\ntitle: "Design Review"\ntags:\n  - meeting\n---\n` + builtInTemplate().split("---\n").slice(2).join("---\n").replace(/\{\{[a-z_]+\}\}/g, "");

const AGENT_REPLY = `### Meeting Overview
**Title:** Acme Zero Trust POV Review
**Date:** 2026-10-06
**Category:** External Customer
**Confidence:** High
**Primary Account / Project:** Acme Corp
**Participants:**
- Alice Smith (Acme, Network Architect)
- Bob Jones (Our team, SE Lead)
**Search Tags:** #External-Customer #Acme-Corp #MeetingNotes #ZeroTrust #POV #2026

### Executive Synthesis
**TL;DR:** Acme reviewed the POV results. They agreed to move to a production pilot.
**Key Decisions Made:**
- Move to a production pilot in November
- Keep SSL inspection off for finance traffic

---
### Action Items & Commitments
| Action Item | Owner | Priority | Due |
| :--- | :--- | :--- | :--- |
| Send the pilot scope document | Bob Jones | High | 2026-10-09 |
| Confirm firewall change window | Customer IT team | Med | TBD |
| Book the kickoff | Unassigned | Low | Next sync |

### Risks, Blockers & Concerns
#### Technical / Architectural
- Firewall policy conflicts
#### Business / Timeline
- None noted

### Customer Deep Dive
- **Customer Sentiment & Account Health**: Aligned.`;

test("copyText sends the calendar details, notes and transcript, with or without instructions", () => {
  const content = "## Notes\n\n- Budget is tight\n\n## Transcript\n\nYou\n0:09 - Let's ship Friday.\n";
  const plain = copyText(content, meeting) ?? "";
  assert.equal(plain, [
    "MEETING DETAILS",
    "Title: Design Review",
    "Date: 2026-10-06",
    "Time: 11:00 AM – 12:00 PM",
    "Attendees: Alice Smith, Bob Jones",
    "",
    "MY NOTES",
    "- Budget is tight",
    "",
    "TRANSCRIPT",
    "You\n0:09 - Let's ship Friday.",
  ].join("\n"));
  const withInstructions = copyText(content, meeting, DEFAULT_INSTRUCTIONS) ?? "";
  assert.ok(withInstructions.startsWith(DEFAULT_INSTRUCTIONS + "\n\nMEETING DETAILS\n"));
  assert.doesNotMatch(DEFAULT_INSTRUCTIONS, /2026/, "the instructions hold no meeting-specific text");
});

test("copyText returns undefined when there is nothing to send", () => {
  assert.equal(copyText("## Notes\n\n- \n\n## Transcript\n\n", meeting), undefined);
});

test("parseReply reads the short format in its usual variations", () => {
  const reply = parseReply([
    "```markdown",
    "**Summary**",
    "We reviewed the design and agreed to ship.",
    "### Key points",
    "",
    "### Decisions:",
    "* Ship on Friday",
    "1. Keep the old API",
    "",
    "## Action Items",
    "- [ ] Update the docs @[[Bob Jones]] 📅 2026-10-09",
    "- Book the launch room",
    "```",
  ].join("\n"));
  assert.deepEqual(reply?.summary, ["We reviewed the design and agreed to ship."]);
  assert.deepEqual(reply?.decisions, ["Ship on Friday", "Keep the old API"]);
  assert.deepEqual(reply?.actionItems.map((i) => actionLine(i)), ["- [ ] Update the docs @[[Bob Jones]] 📅 2026-10-09", "- [ ] Book the launch room"]);
});

test("parseReply reads a full agent report: whole report as summary, decisions, table rows and properties", () => {
  const reply = parseReply(AGENT_REPLY);
  assert.ok(reply);
  assert.equal(reply.summary[0], "### Meeting Overview");
  assert.ok(reply.summary.includes("| Send the pilot scope document | Bob Jones | High | 2026-10-09 |"));
  assert.ok(!reply.summary.some((l) => /^-{3,}$/.test(l)), "horizontal rules are dropped");
  assert.deepEqual(reply.decisions, ["Move to a production pilot in November", "Keep SSL inspection off for finance traffic"]);
  assert.deepEqual(reply.actionItems.map((i) => actionLine(i)), [
    "- [ ] Send the pilot scope document @[[Bob Jones]] ⏫ 📅 2026-10-09",
    "- [ ] Confirm firewall change window (owner: Customer IT team) 🔼",
    "- [ ] Book the kickoff 🔽",
  ]);
  assert.equal(reply.category, "External Customer");
  assert.equal(reply.account, "Acme Corp");
  assert.deepEqual(reply.tags, ["External-Customer", "Acme-Corp", "MeetingNotes", "ZeroTrust", "POV"]);
});

test("parseReply demotes a report's top-level headings below the Meeting Summary heading", () => {
  const reply = parseReply("# Overview\nText\n## Action Items\n| Task | Owner |\n|---|---|\n| Do it | Bob |");
  assert.deepEqual(reply?.summary.slice(0, 3), ["### Overview", "Text", "#### Action Items"]);
  assert.deepEqual(reply?.actionItems.map((i) => actionLine(i)), ["- [ ] Do it @[[Bob]]"]);
});

test("parseReply copes with a report whose table is missing or malformed", () => {
  const reply = parseReply("### Executive Synthesis\n**Key Decisions Made:**\n- None\n### Action Items & Commitments\n- Call Bob\n");
  assert.deepEqual(reply?.decisions, []);
  assert.deepEqual(reply?.actionItems.map((i) => actionLine(i)), ["- [ ] Call Bob"]);
  assert.equal(reply?.category, undefined);
  assert.equal(parseReply("Sure! Here is a summary of the meeting."), undefined);
});

test("applyReply files a full report and changes nothing when applied twice", () => {
  const reply = parseReply(AGENT_REPLY)!;
  const once = applyReply(blankNote, reply, true);
  assert.equal(once.decisions, 2);
  assert.equal(once.actionItems, 3);
  assert.match(once.content, /## Decisions\n\n- Move to a production pilot in November\n- Keep SSL inspection off for finance traffic\n\n## Action items\n\n- \[ \] Send the pilot scope document @\[\[Bob Jones\]\] ⏫ 📅 2026-10-09\n/);
  assert.match(once.content, /## Meeting Summary\n\n### Meeting Overview\n/);
  assert.match(once.content, /\n## Transcript\n/);
  assert.match(once.content, /^meeting_category: "External Customer"$/m);
  assert.match(once.content, /^account: "Acme Corp"$/m);
  assert.match(once.content, /^tags:\n {2}- meeting\n {2}- External-Customer\n {2}- Acme-Corp\n {2}- MeetingNotes\n {2}- ZeroTrust\n {2}- POV$/m);

  const twice = applyReply(once.content, reply, true);
  assert.equal(twice.content, once.content);
  assert.equal(twice.decisions, 0);
  assert.equal(twice.actionItems, 0);
});

test("applyReply keeps the user's own items, skips ticked duplicates, and can leave properties alone", () => {
  const note = blankNote
    .replace("## Decisions\n\n- \n", "## Decisions\n\n- My own decision\n")
    .replace("## Action items\n\n- [ ] \n", "## Action items\n\n- [x] Send the pilot scope document @[[Bob Jones]] 📅 2026-10-09\n");
  const result = applyReply(note, parseReply(AGENT_REPLY)!, false);
  assert.match(result.content, /## Decisions\n\n- My own decision\n- Move to a production pilot/);
  assert.equal(result.actionItems, 2);
  assert.doesNotMatch(result.content, /meeting_category|account:/);
});

test("parseReply ignores the chat around a reply and writes an owner of You as me", () => {
  const fenced = parseReply("Sure! Here's the analysis.\n\n```markdown\n### Overview\n**Key Decisions Made:**\n- Go\n### Action Items\n| Task | Owner |\n|---|---|\n| Review bands | You |\n```\nLet me know if you need more.");
  assert.equal(fenced?.summary[0], "### Overview");
  assert.ok(!fenced?.summary.some((l) => /Let me know|Sure!/.test(l)));
  assert.deepEqual(fenced?.actionItems.map((i) => actionLine(i)), ["- [ ] Review bands (owner: me)"]);

  const unfenced = parseReply("Here you go:\n\n### Overview\n**Key Decisions Made:**\n- Go");
  assert.equal(unfenced?.summary[0], "### Overview");
});

test("action items from a reply get the Tasks plugin's created date", () => {
  const reply = parseReply(AGENT_REPLY)!;
  assert.equal(actionLine(reply.actionItems[0], "2026-10-07"), "- [ ] Send the pilot scope document @[[Bob Jones]] ⏫ ➕ 2026-10-07 📅 2026-10-09");
  const once = applyReply(blankNote, reply, false, "2026-10-07");
  assert.match(once.content, /- \[ \] Book the kickoff 🔽 ➕ 2026-10-07\n/);
  const nextDay = applyReply(once.content, reply, false, "2026-10-08");
  assert.equal(nextDay.content, once.content, "a later run doesn't add the same items with a new created date");
});

const MODE2_REPLY = `> # Acme Zero Trust POV Review
> **Date:** 2026-10-06 | **Category:** Customer
> **Participants:** @[[Alice Smith]], @[[Bob Jones]]
> **Search Tags:** #Customer #Acme #MeetingNotes #ZeroTrust

### 2. Executive Synthesis
- **Executive Summary**: Acme reviewed the POV and agreed to a pilot.
- **Key Decisions**:
  - Move to a production pilot
  - Keep SSL inspection off for finance

### 3. Action Items Table
| Task Description | Owner | Target Date | Status |
| :--- | :--- | :--- | :--- |
| Send the pilot scope | @[[Bob Jones]] | 📅 2026-10-09 | Open |
| Confirm the firewall window | @[[Alice Smith]], @[[Bob Jones]] | TBD | Open |
| Share POV results | Customer IT team | 📅 2026-10-06 | Done |

### 4. Risks, Blockers & Concerns
- **Technical/Architectural**: Firewall policy conflicts.`;

test("parseReply reads the agent's Mode 2 report: quoted details block, link owners, status column", () => {
  const reply = parseReply(MODE2_REPLY)!;
  assert.equal(reply.summary[0], "> # Acme Zero Trust POV Review", "the details block stays in the summary");
  assert.equal(reply.category, "Customer");
  assert.deepEqual(reply.tags, ["Customer", "Acme", "MeetingNotes", "ZeroTrust"]);
  assert.equal(reply.account, undefined);
  assert.deepEqual(reply.decisions, ["Move to a production pilot", "Keep SSL inspection off for finance"]);
  assert.deepEqual(reply.actionItems.map((i) => actionLine(i, "2026-10-07")), [
    "- [ ] Send the pilot scope @[[Bob Jones]] ➕ 2026-10-07 📅 2026-10-09",
    "- [ ] Confirm the firewall window @[[Alice Smith]] @[[Bob Jones]] ➕ 2026-10-07",
    "- [x] Share POV results (owner: Customer IT team) ➕ 2026-10-07 📅 2026-10-06 ✅ 2026-10-07",
  ]);
});

test("parseReply reads numbered bold section labels, inline decisions and an Account / Project field", () => {
  const reply = parseReply([
    "1. **Semantic Metadata Block**:",
    "> **Date:** 2026-10-06 | **Category:** 1:1 | **Account / Project:** Q4 Hiring",
    "2. **Executive Synthesis**:",
    "- **Executive Summary**: Talked hiring.",
    "- **Key Decisions**: Open two SE roles",
    "3. **Action Items Table**:",
    "| Task Description | Owner | Target Date | Status |",
    "| --- | --- | --- | --- |",
    "| Draft the job description | Bob Jones / Alice Smith | 2026-10-13 | Open |",
  ].join("\n"))!;
  assert.equal(reply.category, "1:1");
  assert.equal(reply.account, "Q4 Hiring");
  assert.deepEqual(reply.decisions, ["Open two SE roles"]);
  assert.deepEqual(reply.actionItems.map((i) => actionLine(i)), ["- [ ] Draft the job description @[[Bob Jones]] @[[Alice Smith]] 📅 2026-10-13"]);
  assert.equal(parseReply("- **Key Decisions**: None\n### Action Items\n| Task | Owner |\n|---|---|\n| Do it | Bob |")?.decisions.length, 0);
});

test("parseReply reads the agent's Mode 1 reply", () => {
  const reply = parseReply([
    "## Summary",
    "We reviewed the pilot. Acme agreed to proceed. Dates were set.",
    "",
    "## Decisions",
    "- Proceed with the pilot",
    "",
    "## Action items",
    "- [ ] Send the scope @[[Bob Jones]] 📅 2026-10-09",
    "- [ ] Book the kickoff @[[Alice Smith]]",
    "- [ ] Confirm the budget 📅 2026-10-15",
  ].join("\n"))!;
  assert.deepEqual(reply.summary, ["We reviewed the pilot. Acme agreed to proceed. Dates were set."]);
  assert.deepEqual(reply.decisions, ["Proceed with the pilot"]);
  assert.deepEqual(reply.actionItems.map((i) => actionLine(i, "2026-10-07")), [
    "- [ ] Send the scope @[[Bob Jones]] 📅 2026-10-09 ➕ 2026-10-07",
    "- [ ] Book the kickoff @[[Alice Smith]] ➕ 2026-10-07",
    "- [ ] Confirm the budget 📅 2026-10-15 ➕ 2026-10-07",
  ]);
});

test("a Mode 2 report filed twice changes nothing, including its already-done item", () => {
  const once = applyReply(blankNote, parseReply(MODE2_REPLY)!, true, "2026-10-07");
  assert.match(once.content, /^meeting_category: "Customer"$/m);
  assert.match(once.content, /## Meeting Summary\n\n> # Acme Zero Trust POV Review\n/);
  assert.equal(applyReply(once.content, parseReply(MODE2_REPLY)!, true, "2026-10-08").content, once.content);
});
