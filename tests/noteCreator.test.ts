import test from "node:test";
import assert from "node:assert/strict";
import {
  createNoteContent,
  createNoteFile,
  generateNoteFilename,
  resolveNoteFilePath,
} from "../src/noteCreator";
import type { CalendarEvent } from "../src/calendarApi";
import { createMemoryApp } from "./support/testHelpers";

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

test("createNoteContent sanitizes attendees, strips boilerplate, and omits self attendee", () => {
  const content = createNoteContent(
    {
      ...buildEvent(),
      summary: 'Planning: "Q2"',
      description: `<p>Agenda line</p>
-::~:~::-
Join Zoom Meeting
https://zoom.us/j/123456789
-::~:~::-`,
      attendees: [
        { email: "me@example.com", displayName: "Me", self: true, responseStatus: "accepted" },
        { email: "alex@example.com", displayName: "Alex | Smith", responseStatus: "accepted" },
      ],
      organizer: { email: "alex@example.com", displayName: "Alex | Smith" },
      conferenceData: {
        conferenceSolution: { name: "Zoom" },
        entryPoints: [{ entryPointType: "video", uri: "https://zoom.us/j/123456789" }],
      },
    },
    {
      includeEventNotes: true,
      includeConferenceLinks: true,
    }
  );

  assert.match(content, /title: "Planning: \\"Q2\\""/);
  assert.match(content, /\| 🟢 \| Alex \\| Smith \*\(organizer\)\* \| alex@example\.com \|/);
  assert.doesNotMatch(content, /Join Zoom Meeting/);
  assert.match(content, /\*\*Zoom:\*\* \[Join meeting\]\(https:\/\/zoom\.us\/j\/123456789\)/);
});

test("createNoteContent excludes unsafe conference links", () => {
  const content = createNoteContent(
    {
      ...buildEvent(),
      conferenceData: {
        conferenceSolution: { name: "Video call" },
        entryPoints: [{ entryPointType: "video", uri: "javascript:alert(1)" }],
      },
    },
    {
      includeEventNotes: false,
      includeConferenceLinks: true,
    }
  );

  assert.doesNotMatch(content, /\[Join meeting\]\(/);
});

test("createNoteFile creates folders and reuses existing files idempotently", async () => {
  const app = createMemoryApp();
  const event = buildEvent();

  const first = await createNoteFile(app as never, event, {
    noteFolder: "Meeting Notes",
    includeEventNotes: true,
    includeConferenceLinks: false,
    datePosition: "before",
  });
  const second = await createNoteFile(app as never, event, {
    noteFolder: "Meeting Notes",
    includeEventNotes: true,
    includeConferenceLinks: false,
    datePosition: "before",
  });

  assert.equal(first.wasCreated, true);
  assert.equal(second.wasCreated, false);
  assert.equal(first.file.path, "Meeting Notes/2026-04-03 - Late Night Sync.md");
});
