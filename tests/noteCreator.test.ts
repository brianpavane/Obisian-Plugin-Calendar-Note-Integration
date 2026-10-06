import test from "node:test";
import assert from "node:assert/strict";
import {
  createNoteContent,
  createNoteFile,
  generateNoteFilename,
  resolveNoteFilePath,
  updateNoteContent,
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
    linkAttendees: false,
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
      linkAttendees: false,
    }
  );

  assert.match(content, /title: "Planning: \\"Q2\\""/);
  assert.match(content, /^> \*\*Attendees:\*\* 🟢 Alex \\\| Smith \*\(organizer\)\*$/m);
  assert.doesNotMatch(content, /Me <me@example\.com>/);
  assert.doesNotMatch(content, /Join Zoom Meeting/);
  assert.match(content, /^> \*\*Join:\*\* \[Join Zoom\]\(https:\/\/zoom\.us\/j\/123456789\)$/m);
  assert.match(content, /^meeting_url: "https:\/\/zoom\.us\/j\/123456789"$/m);
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
      linkAttendees: false,
    }
  );

  assert.doesNotMatch(content, /\*\*Join:\*\*/);
  assert.doesNotMatch(content, /^meeting_url:/m);
});

test("createNoteContent excludes plain http conference links", () => {
  const content = createNoteContent(
    {
      ...buildEvent(),
      conferenceData: {
        conferenceSolution: { name: "Zoom" },
        entryPoints: [{ entryPointType: "video", uri: "http://zoom.us/j/123456789" }],
      },
    },
    {
      includeEventNotes: false,
      linkAttendees: false,
    }
  );

  assert.doesNotMatch(content, /\*\*Join:\*\*/);
  assert.doesNotMatch(content, /^meeting_url:/m);
});

test("createNoteFile creates folders and reuses existing files idempotently", async () => {
  const app = createMemoryApp();
  const event = buildEvent();

  const first = await createNoteFile(app as never, event, {
    noteFolder: "Meeting Notes",
    includeEventNotes: true,
    linkAttendees: false,
    datePosition: "before",
  });
  const second = await createNoteFile(app as never, event, {
    noteFolder: "Meeting Notes",
    includeEventNotes: true,
    linkAttendees: false,
    datePosition: "before",
  });

  assert.equal(first.wasCreated, true);
  assert.equal(second.wasCreated, false);
  assert.equal(first.file.path, "Meeting Notes/2026-04-03 - Late Night Sync.md");
});

test("generateNoteFilename uses this machine's date for UTC timestamps", () => {
  const start = "2026-04-04T02:30:00.000Z";
  const d = new Date(start);
  const pad = (n: number) => String(n).padStart(2, "0");
  const localDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const filename = generateNoteFilename(
    buildEvent({ start: { dateTime: start }, end: { dateTime: "2026-04-04T03:30:00.000Z" } }),
    "before"
  );

  assert.equal(filename, `${localDate} - Late Night Sync`);
});

test("createNoteContent uses the meeting format with properties, details callout and sections", () => {
  const content = createNoteContent(
    buildEvent({
      summary: "Weekly Sync",
      start: { dateTime: "2026-01-15T10:00:00-05:00" },
      end: { dateTime: "2026-01-15T11:00:00-05:00" },
      location: "Room B",
      calendarName: "Work",
      organizer: { email: "alice@example.com", displayName: "Alice Smith" },
      attendees: [
        { email: "alice@example.com", displayName: "Alice Smith", responseStatus: "accepted" },
        { email: "bob@example.com", displayName: "Bob Jones", responseStatus: "tentative" },
      ],
      conferenceData: {
        conferenceSolution: { name: "Google Meet" },
        entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }],
      },
    }),
    { includeEventNotes: false, linkAttendees: true }
  );

  assert.match(content, /^type: meeting$/m);
  assert.match(content, /^start: 2026-01-15T10:00$/m);
  assert.match(content, /^end: 2026-01-15T11:00$/m);
  assert.match(content, /^calendar: "Work"$/m);
  assert.match(content, /^organizer: "\[\[Alice Smith\]\]"$/m);
  assert.match(content, /^ {2}- "\[\[Bob Jones\]\]"$/m);
  assert.match(content, /^> \*\*When:\*\* Thursday, January 15, 2026 · 10:00 AM – 11:00 AM \(1h\)$/m);
  assert.match(content, /^> \*\*Where:\*\* Room B$/m);
  assert.match(content, /^> \*\*Join:\*\* \[Join Google Meet\]\(https:\/\/meet\.google\.com\/abc-defg-hij\)$/m);
  assert.match(content, /^> \*\*Attendees:\*\* 🟢 \[\[Alice Smith\]\] \*\(organizer\)\* · 🟡 \[\[Bob Jones\]\]$/m);
  assert.match(content, /## Agenda\n\n- \n\n## Notes\n\n- \n\n## Decisions\n\n- \n\n## Action items\n\n- \[ \] \n$/);
  assert.doesNotMatch(content, /Event description/);
});

test("updateNoteContent refreshes calendar details and keeps the user's writing", () => {
  const original = createNoteContent(
    buildEvent({
      summary: "Planning",
      start: { dateTime: "2026-01-15T10:00:00-05:00" },
      end: { dateTime: "2026-01-15T11:00:00-05:00" },
      location: "Room B",
      attendees: [{ email: "bob@example.com", displayName: "Bob", responseStatus: "needsAction" }],
    }),
    { includeEventNotes: false, linkAttendees: false }
  )
    .replace("tags:\n  - meeting", "tags:\n  - meeting\n  - project-x\nproject: Apollo")
    .replace("## Notes\n\n- ", "## Notes\n\n- My own note");

  const updated = updateNoteContent(
    original,
    buildEvent({
      summary: "Planning",
      start: { dateTime: "2026-01-16T14:00:00-05:00" },
      end: { dateTime: "2026-01-16T14:30:00-05:00" },
      attendees: [{ email: "bob@example.com", displayName: "Bob", responseStatus: "accepted" }],
      cancelled: true,
    }),
    { linkAttendees: false }
  );

  assert.match(updated, /^date: 2026-01-16$/m);
  assert.match(updated, /^start: 2026-01-16T14:00$/m);
  assert.match(updated, /^status: cancelled$/m);
  assert.doesNotMatch(updated, /^location:/m);
  assert.match(updated, /^> \[!danger\] Meeting cancelled$/m);
  assert.match(updated, /^> \*\*When:\*\* Friday, January 16, 2026 · 02:00 PM – 02:30 PM \(30m\)$/m);
  assert.match(updated, /^> \*\*Attendees:\*\* 🟢 Bob$/m);
  assert.doesNotMatch(updated, /Where:/);
  assert.match(updated, /^ {2}- project-x$/m);
  assert.match(updated, /^project: Apollo$/m);
  assert.match(updated, /- My own note/);
  assert.equal(updateNoteContent(updated, buildEvent({
    summary: "Planning",
    start: { dateTime: "2026-01-16T14:00:00-05:00" },
    end: { dateTime: "2026-01-16T14:30:00-05:00" },
    attendees: [{ email: "bob@example.com", displayName: "Bob", responseStatus: "accepted" }],
    cancelled: true,
  }), { linkAttendees: false }), updated);
});

test("createNoteContent puts the event description in the Agenda section", () => {
  const content = createNoteContent(
    buildEvent({ description: "Review Q1 goals\n\nStaffing update" }),
    { includeEventNotes: true, linkAttendees: false }
  );

  assert.match(content, /## Agenda\n\n- Review Q1 goals\n- Staffing update\n- \n\n## Notes/);
  assert.doesNotMatch(content, /Event description/);
});

test("createNoteContent fills a user template and still adds the calendar properties", () => {
  const template = [
    "---",
    "project: \"{{calendar}}\"",
    "tags:",
    "  - work",
    "---",
    "# {{title}} ({{start_time}})",
    "",
    "Join: {{join_link}}",
    "With: {{attendees}}",
    "Day: {{daily_note}}",
    "",
    "{{description_callout}}",
    "",
    "<% tp.date.now() %> {{unknown}}",
    "",
  ].join("\n");

  const content = createNoteContent(
    buildEvent({
      summary: "Design Review",
      calendarName: "Work",
      start: { dateTime: "2026-01-15T10:00:00-05:00" },
      end: { dateTime: "2026-01-15T11:00:00-05:00" },
      attendees: [{ email: "bob@example.com", displayName: "Bob Jones", responseStatus: "accepted" }],
      conferenceData: {
        conferenceSolution: { name: "Zoom" },
        entryPoints: [{ entryPointType: "video", uri: "https://zoom.us/j/1234567" }],
      },
    }),
    {
      includeEventNotes: false,
      linkAttendees: true,
      dailyNote: { format: "YYYY-MM-DD", folder: "Daily" },
      template,
    }
  );

  assert.match(content, /^project: "Work"$/m);
  assert.match(content, /^calendar_event_id: "event-1"\ntags:\n {2}- work\n---$/m);
  assert.match(content, /^daily_note: "\[\[Daily\/2026-01-15\|2026-01-15\]\]"$/m);
  assert.match(content, /^# Design Review \(10:00 AM\)$/m);
  assert.match(content, /^Join: \[Join Zoom\]\(https:\/\/zoom\.us\/j\/1234567\)$/m);
  assert.match(content, /^With: \[\[Bob Jones\]\]$/m);
  assert.match(content, /^Day: \[\[Daily\/2026-01-15\|2026-01-15\]\]$/m);
  assert.match(content, /^<% tp\.date\.now\(\) %> \{\{unknown\}\}$/m);
  assert.doesNotMatch(content, /Event description/);
  assert.doesNotMatch(content, /\n\n\n/);
});

test("createNoteContent adds frontmatter to a template that has none", () => {
  const content = createNoteContent(buildEvent(), {
    includeEventNotes: false,
    linkAttendees: false,
    template: "# {{title}}\n",
  });

  assert.match(content, /^---\ntitle: "Late Night Sync"\ndate: 2026-04-03\n/);
  assert.match(content, /^calendar_event_id: "event-1"\n---\n\n# Late Night Sync\n$/m);
});

test("daily-note links follow the date when a meeting moves", () => {
  const options = { includeEventNotes: false, linkAttendees: false, dailyNote: { format: "YYYY-MM-DD", folder: "" } };
  const original = createNoteContent(
    buildEvent({ start: { dateTime: "2026-01-15T10:00:00-05:00" }, end: { dateTime: "2026-01-15T11:00:00-05:00" } }),
    options
  );
  assert.match(original, /^> \*\*When:\*\* \[\[2026-01-15\|Thursday, January 15, 2026\]\] · /m);

  const updated = updateNoteContent(
    original,
    buildEvent({ start: { dateTime: "2026-01-16T10:00:00-05:00" }, end: { dateTime: "2026-01-16T11:00:00-05:00" } }),
    options
  );
  assert.match(updated, /^daily_note: "\[\[2026-01-16\]\]"$/m);
  assert.match(updated, /^> \*\*When:\*\* \[\[2026-01-16\|Friday, January 16, 2026\]\] · /m);
});
