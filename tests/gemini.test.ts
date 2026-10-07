import test from "node:test";
import assert from "node:assert/strict";
import { applyReply, buildPrompt, parseReply } from "../src/gemini";
import { builtInTemplate } from "../src/noteCreator";

const meeting = { title: "Design Review", when: "2026-10-06, 11:00 AM – 12:00 PM", date: "2026-10-06", attendees: ["Alice Smith", "Bob Jones"] };

test("buildPrompt includes the meeting, notes and transcript, and asks for the fixed format", () => {
  const content = "## Notes\n\n- Budget is tight\n\n## Transcript\n\nAlice: Let's ship Friday.\n";
  const prompt = buildPrompt(content, meeting) ?? "";
  assert.match(prompt, /^## Summary$/m);
  assert.match(prompt, /^## Decisions$/m);
  assert.match(prompt, /^## Action items$/m);
  assert.match(prompt, /@Bob/);
  assert.match(prompt, /meeting was on 2026-10-06/);
  assert.match(prompt, /^Meeting: Design Review$/m);
  assert.match(prompt, /^Attendees: Alice Smith, Bob Jones$/m);
  assert.match(prompt, /My notes:\n- Budget is tight/);
  assert.match(prompt, /Transcript:\nAlice: Let's ship Friday\./);
});

test("buildPrompt returns undefined when there is nothing to summarize", () => {
  assert.equal(buildPrompt("## Notes\n\n- \n\n## Transcript\n\n", meeting), undefined);
});

test("parseReply reads Gemini's sections in their usual variations", () => {
  const reply = parseReply([
    "```markdown",
    "**Summary**",
    "We reviewed the design and agreed to ship.",
    "",
    "### Decisions:",
    "* Ship on Friday",
    "1. Keep the old API",
    "",
    "## Action Items",
    "- [ ] Update the docs @Bob 📅 2026-10-09",
    "- Book the launch room",
    "```",
  ].join("\n"));
  assert.deepEqual(reply, {
    summary: ["We reviewed the design and agreed to ship."],
    decisions: ["- Ship on Friday", "- Keep the old API"],
    actionItems: ["- [ ] Update the docs @Bob 📅 2026-10-09", "- [ ] Book the launch room"],
  });
});

test("parseReply drops 'None' and rejects text without the headings", () => {
  assert.deepEqual(parseReply("## Summary\nShort.\n## Decisions\n- None\n## Action items\n- None.")?.decisions, []);
  assert.equal(parseReply("Sure! Here is a summary of the meeting."), undefined);
});

test("applyReply fills the built-in note's sections", () => {
  const note = builtInTemplate().replace(/\{\{[a-z_]+\}\}/g, "");
  const out = applyReply(note, {
    summary: ["Shipped."],
    decisions: ["- Ship Friday"],
    actionItems: ["- [ ] Update docs @Bob"],
  });
  assert.match(out, /## Decisions\n\n- Ship Friday\n\n## Action items\n\n- \[ \] Update docs @Bob\n\n## Meeting Summary\n\nShipped\.\n\n## Transcript/);
});

test("parseReply turns Gemini's extra headings into bold text so the note's sections stay intact", () => {
  const reply = parseReply("## Summary\n### Key points\nShipped.\n## Decisions\n- None");
  assert.deepEqual(reply?.summary, ["**Key points**", "Shipped."]);
});
