import test from "node:test";
import assert from "node:assert/strict";
import {
  createNoteContent,
  generateNoteFilename,
  resolveNoteFilePath,
} from "../src/noteCreator";
import type { CalendarEvent } from "../src/calendarApi";

function buildEvent(overrides = {}) {
  const base = {
    id: "event-1",
    summary: "Late Night Sync",
    start: { dateTime: "2026-04-03T23:30:00-04:00" },
    end: { dateTime: "2026-04-04T00:30:00-04:00" },
  };
  return { ...base, ...overrides } as CalendarEvent;
}

test("generateNoteFilename preserves the event's local calendar date", () => {
  const filename = generateNoteFilename(buildEvent(), "before");
  assert.equal(filename, "2026-04-03 - Late Night Sync");
});

test("resolveNoteFilePath preserves the event's local date in the final path", () => {
  const filePath = resolveNoteFilePath(buildEvent(), {
    noteFolder: "Meeting Notes",
    datePosition: "after",
  });

  assert.equal(filePath, "Meeting Notes/Late Night Sync - 2026-04-03.md");
});

test("createNoteContent writes the original event date into frontmatter", () => {
  const content = createNoteContent(buildEvent(), {
    includeEventNotes: false,
    includeConferenceLinks: false,
  });

  assert.match(content, /^date: 2026-04-03$/m);
  assert.doesNotMatch(content, /^date: 2026-04-04$/m);
});
