import test from "node:test";
import assert from "node:assert/strict";
import GoogleCalendarPlugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  App,
  getNotices,
  resetObsidianTestState,
  TFile,
} from "./support/obsidianStub";
import { createMemoryApp, buildEvent } from "./support/testHelpers";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

function createPlugin(app?: App): GoogleCalendarPlugin {
  const plugin = new GoogleCalendarPlugin(
    (app ?? createMemoryApp()) as never,
    {
      id: "calendar-note-integration",
      name: "Calendar Note Integration",
      author: "Test",
      minAppVersion: "1.0.0",
      description: "Test manifest",
      version: "test",
    } as never
  ) as GoogleCalendarPlugin;
  plugin.now = () => new Date("2026-04-03T06:00:00-04:00");
  return plugin;
}

test.afterEach(() => {
  resetObsidianTestState();
});

test("loadSettings clamps numeric values and sanitizes invalid fields", async () => {
  const plugin = createPlugin();
  plugin.loadData = async () => ({
    daysAhead: 99,
    maxEvents: 0,
    hoursInAdvance: "500",
    pollIntervalMinutes: 1,
    daysBack: -5,
    includePastEvents: "yes",
    includeEventNotes: "no",
    linkAttendees: null,
    datePosition: "sideways",
    processedEventIds: "not-an-array",
  });

  await plugin.loadSettings();

  assert.equal(plugin.settings.daysAhead, 30);
  assert.equal(plugin.settings.maxEvents, 20);
  assert.equal(plugin.settings.hoursInAdvance, 48);
  assert.equal(plugin.settings.pollIntervalMinutes, 5);
  assert.equal(plugin.settings.daysBack, 1);
  assert.equal(plugin.settings.includePastEvents, false);
  assert.equal(plugin.settings.includeEventNotes, true);
  assert.equal(plugin.settings.linkAttendees, false);
  assert.equal(plugin.settings.datePosition, "before");
  assert.deepEqual(plugin.settings.processedEventIds, []);
});

test("refreshNotes bootstraps existing files and only creates genuinely new notes", async () => {
  const app = createMemoryApp([
    { path: "Meeting Notes/2026-04-03 - Existing.md", content: "existing" },
    { path: "Meeting Notes", content: "" },
  ]);
  const plugin = createPlugin(app);
  plugin.settings = {
    ...DEFAULT_SETTINGS,
    authMode: "apple",
    noteFolder: "Meeting Notes",
    processedEventIds: [],
  };

  const existingEvent = buildEvent({
    id: "existing-id",
    summary: "Existing",
    start: { dateTime: "2026-04-03T10:00:00-04:00" },
    end: { dateTime: "2026-04-03T11:00:00-04:00" },
  });
  const newEvent = buildEvent({
    id: "new-id",
    summary: "New Event",
    start: { dateTime: "2026-04-03T12:00:00-04:00" },
    end: { dateTime: "2026-04-03T13:00:00-04:00" },
  });

  plugin.getCalendarService = async () =>
    ({
      queriedCalendars: () => undefined,
      fetchedEventIds: () => undefined,
      listEventsInTimeWindow: async () => [existingEvent, newEvent],
    } as never);

  await plugin.refreshNotes(true);

  assert.deepEqual(plugin.settings.processedEventIds.sort(), ["existing-id", "new-id"]);
  assert.deepEqual(app.createdPaths, ["Meeting Notes/2026-04-03 - New Event.md"]);
  assert.match(getNotices().at(-1)?.message ?? "", /Created 1 note/);
});

test("refreshNotes filters all-day and declined self events", async () => {
  const app = createMemoryApp([{ path: "Meeting Notes", content: "" }]);
  const plugin = createPlugin(app);
  plugin.settings = {
    ...DEFAULT_SETTINGS,
    authMode: "apple",
    selfEmail: "me@example.com",
    noteFolder: "Meeting Notes",
    processedEventIds: [],
  };

  plugin.getCalendarService = async () =>
    ({
      queriedCalendars: () => undefined,
      fetchedEventIds: () => undefined,
      listEventsInTimeWindow: async () => [
        buildEvent({ id: "all-day", start: { date: "2026-04-03" }, end: { date: "2026-04-04" } }),
        buildEvent({
          id: "declined",
          attendees: [{ email: "me@example.com", responseStatus: "declined" }],
        }),
        buildEvent({
          id: "accepted",
          summary: "Accepted Meeting",
          attendees: [{ email: "me@example.com", responseStatus: "accepted" }],
        }),
      ],
    } as never);

  await plugin.refreshNotes(false);

  assert.deepEqual(app.createdPaths, ["Meeting Notes/2026-04-03 - Accepted Meeting.md"]);
  assert.deepEqual(plugin.settings.processedEventIds, ["accepted"]);
});

test("refreshNotes filters events declined by the calendar's self attendee without selfEmail", async () => {
  const app = createMemoryApp([{ path: "Meeting Notes", content: "" }]);
  const plugin = createPlugin(app);
  plugin.settings = {
    ...DEFAULT_SETTINGS,
    authMode: "apple",
    selfEmail: "",
    noteFolder: "Meeting Notes",
    processedEventIds: [],
  };

  plugin.getCalendarService = async () =>
    ({
      queriedCalendars: () => undefined,
      fetchedEventIds: () => undefined,
      listEventsInTimeWindow: async () => [
        buildEvent({
          id: "declined",
          attendees: [{ email: "me@example.com", self: true, responseStatus: "declined" }],
        }),
        buildEvent({
          id: "other-declined",
          summary: "Someone Else Declined",
          attendees: [{ email: "them@example.com", responseStatus: "declined" }],
        }),
      ],
    } as never);

  await plugin.refreshNotes(false);

  assert.deepEqual(app.createdPaths, ["Meeting Notes/2026-04-03 - Someone Else Declined.md"]);
  assert.deepEqual(plugin.settings.processedEventIds, ["other-declined"]);
});

test("rebuildNotes recreates deleted files even if the event was already processed", async () => {
  const app = createMemoryApp([{ path: "Meeting Notes", content: "" }]);
  const plugin = createPlugin(app);
  plugin.settings = {
    ...DEFAULT_SETTINGS,
    authMode: "apple",
    noteFolder: "Meeting Notes",
    processedEventIds: ["event-1"],
  };

  plugin.getCalendarService = async () =>
    ({
      queriedCalendars: () => undefined,
      fetchedEventIds: () => undefined,
      listEventsInTimeWindow: async () => [buildEvent()],
    } as never);

  await plugin.rebuildNotes(true);

  assert.deepEqual(app.createdPaths, ["Meeting Notes/2026-04-03 - Team Sync.md"]);
  assert.deepEqual(plugin.settings.processedEventIds, ["event-1"]);
  assert.match(getNotices().at(-1)?.message ?? "", /Created 1 note/);
});

test("createNoteForNextEvent opens the next filtered event file", async () => {
  const app = createMemoryApp([{ path: "Meeting Notes", content: "" }]);
  const plugin = createPlugin(app);
  plugin.settings = {
    ...DEFAULT_SETTINGS,
    authMode: "apple",
    noteFolder: "Meeting Notes",
    selfEmail: "me@example.com",
  };

  plugin.getCalendarService = async () =>
    ({
      listUpcomingEvents: async () => [
        buildEvent({
          id: "declined",
          attendees: [{ email: "me@example.com", responseStatus: "declined" }],
        }),
        buildEvent({
          id: "next",
          summary: "Next Event",
          attendees: [{ email: "me@example.com", responseStatus: "accepted" }],
        }),
      ],
    } as never);

  await plugin.createNoteForNextEvent();

  assert.deepEqual(app.openedFiles, ["Meeting Notes/2026-04-03 - Next Event.md"]);
  assert.match(getNotices().at(-1)?.message ?? "", /Note ready:/);
});

function appleSettings(overrides: Partial<typeof DEFAULT_SETTINGS> = {}) {
  return {
    ...DEFAULT_SETTINGS,
    authMode: "apple" as const,
    noteFolder: "Meeting Notes",
    processedEventIds: [],
    ...overrides,
  };
}

test("refreshNotes updates an existing note and renames it when the meeting moves day", async () => {
  const app = createMemoryApp([{ path: "Meeting Notes", content: "" }]);
  const plugin = createPlugin(app);
  plugin.settings = appleSettings();

  const original = buildEvent({ id: "moving", summary: "Planning", location: "Room B" });
  plugin.getCalendarService = async () =>
    ({ queriedCalendars: () => undefined, fetchedEventIds: () => undefined, listEventsInTimeWindow: async () => [original] } as never);
  await plugin.refreshNotes(false);

  const file = app.files.get("Meeting Notes/2026-04-03 - Planning.md") as TFile;
  file.content = (file.content ?? "").replace("## Notes\n\n- ", "## Notes\n\n- Prep slides");

  const moved = buildEvent({
    id: "moving",
    summary: "Planning",
    start: { dateTime: "2026-04-06T09:00:00-04:00" },
    end: { dateTime: "2026-04-06T09:30:00-04:00" },
  });
  plugin.getCalendarService = async () =>
    ({ queriedCalendars: () => undefined, fetchedEventIds: () => undefined, listEventsInTimeWindow: async () => [moved] } as never);
  await plugin.refreshNotes(true);

  assert.deepEqual(app.renamed, [
    ["Meeting Notes/2026-04-03 - Planning.md", "Meeting Notes/2026-04-06 - Planning.md"],
  ]);
  const content = (app.files.get("Meeting Notes/2026-04-06 - Planning.md") as TFile).content ?? "";
  assert.match(content, /^start: 2026-04-06T09:00$/m);
  assert.doesNotMatch(content, /^location:/m);
  assert.match(content, /- Prep slides/);
  assert.equal(app.createdPaths.length, 1);
  assert.match(getNotices().at(-1)?.message ?? "", /Updated 1 note/);
});

test("refreshNotes marks an existing note cancelled but never creates notes for cancelled events", async () => {
  const app = createMemoryApp([{ path: "Meeting Notes", content: "" }]);
  const plugin = createPlugin(app);
  plugin.settings = appleSettings();

  plugin.getCalendarService = async () =>
    ({ queriedCalendars: () => undefined, fetchedEventIds: () => undefined, listEventsInTimeWindow: async () => [buildEvent({ id: "a", summary: "Kept" })] } as never);
  await plugin.refreshNotes(false);

  plugin.getCalendarService = async () =>
    ({
      queriedCalendars: () => undefined,
      fetchedEventIds: () => undefined,
      listEventsInTimeWindow: async () => [
        buildEvent({ id: "a", summary: "Kept", cancelled: true }),
        buildEvent({ id: "b", summary: "Never", cancelled: true }),
      ],
    } as never);
  await plugin.refreshNotes(false);

  assert.deepEqual(app.createdPaths, ["Meeting Notes/2026-04-03 - Kept.md"]);
  const content = (app.files.get("Meeting Notes/2026-04-03 - Kept.md") as TFile).content ?? "";
  assert.match(content, /^status: cancelled$/m);
  assert.match(content, /^> \[!danger\] Meeting cancelled$/m);
});

test("runStartupSweep rebuilds once after an upgrade, then refreshes", async () => {
  const app = createMemoryApp([{ path: "Meeting Notes", content: "" }]);
  const plugin = createPlugin(app);
  plugin.settings = appleSettings({ processedEventIds: ["deleted"], lastRunVersion: "6.6.1" });
  plugin.getCalendarService = async () =>
    ({ queriedCalendars: () => undefined, fetchedEventIds: () => undefined, listEventsInTimeWindow: async () => [buildEvent({ id: "deleted", summary: "Back" })] } as never);

  await plugin.runStartupSweep();
  assert.deepEqual(app.createdPaths, ["Meeting Notes/2026-04-03 - Back.md"]);
  assert.equal(plugin.settings.lastRunVersion, "test");

  app.files.delete("Meeting Notes/2026-04-03 - Back.md");
  await plugin.runStartupSweep();
  assert.deepEqual(app.createdPaths, ["Meeting Notes/2026-04-03 - Back.md"]);
});

test("runStartupSweep retries the upgrade rebuild if the calendar can't be read", async () => {
  const plugin = createPlugin();
  plugin.settings = appleSettings({ lastRunVersion: "6.6.1" });
  plugin.getCalendarService = async () => {
    throw new Error("Calendar unavailable");
  };

  await plugin.runStartupSweep();

  assert.equal(plugin.settings.lastRunVersion, "6.6.1");
});

test("refreshNotes leaves unchanged notes untouched", async () => {
  const app = createMemoryApp([{ path: "Meeting Notes", content: "" }]);
  const plugin = createPlugin(app);
  plugin.settings = appleSettings();
  plugin.getCalendarService = async () =>
    ({ queriedCalendars: () => undefined, fetchedEventIds: () => undefined, listEventsInTimeWindow: async () => [buildEvent({ id: "same", summary: "Same" })] } as never);
  await plugin.refreshNotes(false);

  let writes = 0;
  const process = app.vault.process;
  app.vault.process = async (file, fn) => {
    writes++;
    return process(file, fn);
  };
  await plugin.refreshNotes(true);

  assert.equal(writes, 0);
  assert.match(getNotices().at(-1)?.message ?? "", /All notes are up to date/);
});

test("refreshNotes uses the template note and the Daily Notes format", async () => {
  const app = createMemoryApp([
    { path: "Meeting Notes", content: "" },
    { path: "Templates/Meeting.md", content: "# {{title}}\n\nDay: {{daily_note}}\n" },
  ]);
  (app as unknown as { internalPlugins: unknown }).internalPlugins = {
    getPluginById: (id: string) =>
      id === "daily-notes" ? { instance: { options: { format: "YYYY/MM/DD", folder: "Journal" } } } : null,
  };
  const plugin = createPlugin(app);
  plugin.settings = appleSettings({ templatePath: "Templates/Meeting" });
  plugin.getCalendarService = async () =>
    ({ queriedCalendars: () => undefined, fetchedEventIds: () => undefined, listEventsInTimeWindow: async () => [buildEvent({ id: "t", summary: "Templated" })] } as never);

  await plugin.refreshNotes(false);

  const content = (app.files.get("Meeting Notes/2026-04-03 - Templated.md") as TFile).content ?? "";
  assert.match(content, /^# Templated$/m);
  assert.match(content, /^Day: \[\[Journal\/2026\/04\/03\|03\]\]$/m);
  assert.match(content, /^calendar_event_id: "t"$/m);
});

test("refreshNotes falls back to the built-in format when the template is missing", async () => {
  const app = createMemoryApp([{ path: "Meeting Notes", content: "" }]);
  const plugin = createPlugin(app);
  plugin.settings = appleSettings({ templatePath: "Templates/Missing.md", dailyNoteLink: false });
  plugin.getCalendarService = async () =>
    ({ queriedCalendars: () => undefined, fetchedEventIds: () => undefined, listEventsInTimeWindow: async () => [buildEvent({ id: "m", summary: "Fallback" })] } as never);

  await plugin.refreshNotes(true);

  const content = (app.files.get("Meeting Notes/2026-04-03 - Fallback.md") as TFile).content ?? "";
  assert.match(content, /^> \[!info\] Meeting details$/m);
  assert.doesNotMatch(content, /daily_note/);
  assert.ok(getNotices().some((n) => /template "Templates\/Missing\.md" not found/.test(n.message)));
});

function appleService(events: ReturnType<typeof buildEvent>[], calendars: string[], allIds?: string[]) {
  return async () =>
    ({
      queriedCalendars: () => calendars,
      fetchedEventIds: () => new Set(allIds ?? events.map((e) => e.id)),
      listEventsInTimeWindow: async () => events,
    } as never);
}

test("refreshNotes marks notes of meetings deleted from the calendar, and restores them", async () => {
  const app = createMemoryApp([{ path: "Meeting Notes", content: "" }]);
  const plugin = createPlugin(app);
  plugin.settings = appleSettings({ dailyNoteLink: false });

  const work = buildEvent({ id: "w", summary: "Work Sync", calendarName: "Work" });
  const home = buildEvent({ id: "h", summary: "Dentist", calendarName: "Home" });
  plugin.getCalendarService = appleService([work, home], ["Work", "Home"]);
  await plugin.refreshNotes(false);

  // "w" is deleted; "Home" is no longer selected, so its note must be left alone.
  plugin.getCalendarService = appleService([], ["Work"]);
  await plugin.refreshNotes(true);

  const workNote = () => (app.files.get("Meeting Notes/2026-04-03 - Work Sync.md") as TFile).content ?? "";
  const homeNote = (app.files.get("Meeting Notes/2026-04-03 - Dentist.md") as TFile).content ?? "";
  assert.match(workNote(), /^status: removed$/m);
  assert.match(workNote(), /^> \[!danger\] Meeting removed from calendar$/m);
  assert.doesNotMatch(homeNote, /status:/);
  assert.match(getNotices().at(-1)?.message ?? "", /Marked 1 note removed from calendar/);

  plugin.getCalendarService = appleService([work], ["Work"]);
  await plugin.refreshNotes(false);
  assert.doesNotMatch(workNote(), /^status:/m);
  assert.match(workNote(), /^> \[!info\] Meeting details$/m);
});

test("refreshNotes does not mark a meeting removed when it moved outside the window", async () => {
  const app = createMemoryApp([{ path: "Meeting Notes", content: "" }]);
  const plugin = createPlugin(app);
  plugin.settings = appleSettings();
  const meeting = buildEvent({ id: "moved", summary: "Moved", calendarName: "Work" });
  plugin.getCalendarService = appleService([meeting], ["Work"]);
  await plugin.refreshNotes(false);

  plugin.getCalendarService = appleService([], ["Work"], ["moved"]);
  await plugin.refreshNotes(false);

  const content = (app.files.get("Meeting Notes/2026-04-03 - Moved.md") as TFile).content ?? "";
  assert.doesNotMatch(content, /status:/);
});

test("a failed background sync shows one notice until a sync succeeds", async () => {
  const plugin = createPlugin();
  plugin.settings = appleSettings();
  plugin.getCalendarService = async () => {
    throw new Error("Calendar unavailable");
  };

  await plugin.refreshNotes(false);
  await plugin.refreshNotes(false);
  assert.equal(getNotices().filter((n) => /couldn't read your calendar/.test(n.message)).length, 1);

  plugin.getCalendarService = appleService([], []);
  await plugin.refreshNotes(false);
  plugin.getCalendarService = async () => {
    throw new Error("Calendar unavailable");
  };
  await plugin.refreshNotes(false);
  assert.equal(getNotices().filter((n) => /couldn't read your calendar/.test(n.message)).length, 2);
});

test("joinMeeting opens the meeting's note and its join link", async () => {
  const app = createMemoryApp([{ path: "Meeting Notes", content: "" }]);
  const plugin = createPlugin(app);
  plugin.settings = appleSettings();
  plugin.now = () => new Date("2026-04-03T09:50:00-04:00");
  const opened: string[] = [];
  (globalThis as unknown as { window: unknown }).window = { open: (url: string) => opened.push(url) };

  plugin.getCalendarService = appleService(
    [
      buildEvent({
        id: "j",
        summary: "Standup",
        conferenceData: {
          conferenceSolution: { name: "Zoom" },
          entryPoints: [{ entryPointType: "video", uri: "https://zoom.us/j/555" }],
        },
      }),
    ],
    []
  );
  await plugin.joinMeeting();

  assert.deepEqual(opened, ["https://zoom.us/j/555"]);
  assert.deepEqual(app.openedFiles, ["Meeting Notes/2026-04-03 - Standup.md"]);
});

test("joinMeeting does nothing when no meeting is near", async () => {
  const plugin = createPlugin();
  plugin.settings = appleSettings();
  plugin.now = () => new Date("2026-04-03T06:00:00-04:00");
  plugin.getCalendarService = appleService([buildEvent({ id: "late" })], []);

  await plugin.joinMeeting();

  assert.match(getNotices().at(-1)?.message ?? "", /No meeting in progress or starting in the next 30 minutes/);
});

test("openDashboard creates the Bases file once and opens it", async () => {
  const app = createMemoryApp();
  const plugin = createPlugin(app);
  plugin.settings = appleSettings();

  await plugin.openDashboard();
  await plugin.openDashboard();

  assert.deepEqual(app.createdPaths, ["Meeting Notes/Meetings.base"]);
  assert.deepEqual(app.openedFiles, ["Meeting Notes/Meetings.base", "Meeting Notes/Meetings.base"]);
  const content = (app.files.get("Meeting Notes/Meetings.base") as TFile).content ?? "";
  assert.match(content, /file\.hasProperty\("calendar_event_id"\)/);
});

test("refreshNotes links each recurring meeting to the previous one and carries open items", async () => {
  const app = createMemoryApp([{ path: "Meeting Notes", content: "" }]);
  const plugin = createPlugin(app);
  plugin.settings = appleSettings({ hoursInAdvance: 48 });

  const occurrence = (day: string) => buildEvent({
    id: `weekly::2026-04-0${day}T14:00:00.000Z`,
    summary: "Weekly Sync",
    start: { dateTime: `2026-04-0${day}T10:00:00-04:00` },
    end: { dateTime: `2026-04-0${day}T10:30:00-04:00` },
  });
  plugin.getCalendarService = async () =>
    ({ queriedCalendars: () => undefined, fetchedEventIds: () => undefined, listEventsInTimeWindow: async () => [occurrence("3")] } as never);
  await plugin.refreshNotes(false);

  const first = app.files.get("Meeting Notes/2026-04-03 - Weekly Sync.md") as TFile;
  first.content = (first.content ?? "").replace("## Action items\n\n- [ ] ", "## Action items\n\n- [ ] Send deck\n- [x] Book room\n- [ ] ");

  plugin.getCalendarService = async () =>
    ({ queriedCalendars: () => undefined, fetchedEventIds: () => undefined, listEventsInTimeWindow: async () => [occurrence("3"), occurrence("4")] } as never);
  await plugin.refreshNotes(false);

  const second = (app.files.get("Meeting Notes/2026-04-04 - Weekly Sync.md") as TFile).content ?? "";
  assert.match(second, /^> \*\*Previous:\*\* \[\[Meeting Notes\/2026-04-03 - Weekly Sync\|2026-04-03 - Weekly Sync\]\]$/m);
  assert.match(second, /- Open items from \[\[Meeting Notes\/2026-04-03 - Weekly Sync\|last meeting\]\]:\n  - Send deck\n- \n/);
  assert.doesNotMatch(second, /Book room/);
  assert.doesNotMatch(first.content ?? "", /Previous:/);
});

test("loadDayEvents reads the given day midnight to midnight and drops all-day and declined meetings", async () => {
  const plugin = createPlugin();
  plugin.settings = appleSettings({ selfEmail: "me@example.com" });
  let window: [Date, Date] | undefined;
  plugin.getCalendarService = async () =>
    ({
      queriedCalendars: () => undefined,
      fetchedEventIds: () => undefined,
      listEventsInTimeWindow: async (min: Date, max: Date) => {
        window = [min, max];
        return [
          buildEvent({ id: "kept" }),
          buildEvent({ id: "all-day", start: { date: "2026-04-03" }, end: { date: "2026-04-04" } }),
          buildEvent({ id: "declined", attendees: [{ email: "me@example.com", responseStatus: "declined" }] }),
        ];
      },
    } as never);

  const events = await plugin.loadDayEvents(new Date(2026, 3, 4));
  assert.deepEqual(events?.map((e) => e.id), ["kept"]);
  assert.deepEqual(window?.map((d) => d.getTime()), [
    new Date(2026, 3, 4).getTime(),
    new Date(2026, 3, 5).getTime(),
  ]);
});

const serviceFor = (events: ReturnType<typeof buildEvent>[]) => async () =>
  ({
    queriedCalendars: () => undefined,
    fetchedEventIds: () => undefined,
    listEventsInTimeWindow: async () => events,
  } as never);

test("refreshNotes skips listed titles and solo events for new notes but still updates existing ones", async () => {
  const app = createMemoryApp([
    { path: "Meeting Notes/2026-04-03 - Lunch.md", content: "---\ntitle: \"Lunch\"\ncalendar_event_id: \"lunch\"\n---\n" },
  ]);
  const plugin = createPlugin(app);
  plugin.settings = appleSettings({ skipTitles: "lunch\nfocus", skipSolo: true });
  const other = [{ email: "bob@example.com" }];
  plugin.getCalendarService = serviceFor([
    buildEvent({ id: "lunch", summary: "Lunch", location: "Cafe", attendees: other }),
    buildEvent({ id: "focus", summary: "Focus block", attendees: other }),
    buildEvent({ id: "solo", summary: "Prep", attendees: [] }),
    buildEvent({ id: "sync", summary: "Sync", attendees: other }),
  ]);

  await plugin.refreshNotes(false);

  assert.deepEqual(app.createdPaths, ["Meeting Notes/2026-04-03 - Sync.md"]);
  assert.match((app.files.get("Meeting Notes/2026-04-03 - Lunch.md") as TFile).content ?? "", /^location: "Cafe"$/m);
  assert.ok(!plugin.settings.processedEventIds.includes("focus"));
});

test("notes filed outside the note folder are still found, updated and opened", async () => {
  const app = createMemoryApp([
    { path: "Clients/Acme/2026/Q2/Projects/Launch/2026-04-03 - Sync.md", content: "---\ntitle: \"Sync\"\ncalendar_event_id: \"sync\"\n---\n\n## Notes\n\n- Mine\n" },
  ]);
  const plugin = createPlugin(app);
  plugin.settings = appleSettings();
  const event = buildEvent({ id: "sync", summary: "Sync", location: "Room 4" });
  plugin.getCalendarService = serviceFor([event]);

  await plugin.refreshNotes(false);
  await plugin.openNoteForEvent(event);

  assert.deepEqual(app.createdPaths, []);
  assert.deepEqual(app.openedFiles, ["Clients/Acme/2026/Q2/Projects/Launch/2026-04-03 - Sync.md"]);
  assert.match((app.files.get("Clients/Acme/2026/Q2/Projects/Launch/2026-04-03 - Sync.md") as TFile).content ?? "", /^location: "Room 4"$/m);

  plugin.getCalendarService = serviceFor([{ ...event, start: { dateTime: "2026-04-04T10:00:00-04:00" }, end: { dateTime: "2026-04-04T11:00:00-04:00" } }]);
  plugin.now = () => new Date("2026-04-04T06:00:00-04:00");
  await plugin.refreshNotes(false);
  assert.deepEqual(app.renamed, [[
    "Clients/Acme/2026/Q2/Projects/Launch/2026-04-03 - Sync.md",
    "Clients/Acme/2026/Q2/Projects/Launch/2026-04-04 - Sync.md",
  ]]);
});

test("Krisp transcripts are only proposed, never written, until an import is confirmed", async () => {
  const root = await mkdtemp(join(tmpdir(), "krisp-main-"));
  try {
    const folder = "Weekly Sync - April 2, 2026 10-01-30 AM";
    await mkdir(join(root, folder));
    await writeFile(join(root, folder, "transcript.txt"), "Weekly Sync - April 2, 2026 10-01-30 AM\nApril 2, 2026 10:01:30 AM\n30m 2s\n\n\nYou\n0:01 - hello");
    const noteText = (title: string, start: string, end: string) =>
      `---\ntitle: "${title}"\nstart: ${start}\nend: ${end}\ncalendar_event_id: "${title}"\n---\n\n## Notes\n\n- \n\n## Transcript\n\n`;
    const app = createMemoryApp([
      { path: "Projects/Weekly Sync.md", content: noteText("Weekly Sync", "2026-04-02T10:00", "2026-04-02T10:30") },
      { path: "Meeting Notes/Later.md", content: noteText("Later", "2026-04-03T10:00", "2026-04-03T11:00") },
    ]);
    const plugin = createPlugin(app);
    plugin.settings = appleSettings({ krispFolder: root, krispAutoImport: true });
    plugin.getCalendarService = serviceFor([]);
    const note = app.files.get("Projects/Weekly Sync.md") as TFile;
    const before = note.content;

    await plugin.refreshNotes(false);
    assert.equal(note.content, before, "a sync only asks");

    const proposals = await plugin.transcriptProposals();
    assert.deepEqual(proposals.map((p) => [p.file.path, p.candidates.map((r) => r.name)]), [["Projects/Weekly Sync.md", [folder]]]);

    assert.equal(await plugin.importTranscripts([{ file: note as never, recording: proposals[0].candidates[0] }]), 1);
    assert.match(note.content ?? "", /## Transcript\n\nYou\n0:01 - hello\n$/);
    assert.match(note.content ?? "", new RegExp(`^krisp_recording: "${folder}"$`, "m"));
    assert.match(note.content ?? "", /## Notes\n\n- \n/);

    assert.deepEqual(await plugin.transcriptProposals(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadSettings keeps every note section on unless switched off", async () => {
  const plugin = createPlugin();
  plugin.loadData = async () => ({ noteSections: { transcript: false, agenda: "no" }, skipSolo: "yes", krispFolder: 5 });
  await plugin.loadSettings();
  assert.deepEqual(plugin.settings.noteSections, {
    agenda: true, notes: true, decisions: true, actionItems: true, summary: true, transcript: false,
  });
  assert.equal(plugin.settings.skipSolo, false);
  assert.equal(plugin.settings.krispFolder, "~/Documents/Transcripts/Krisp Meetings");
  assert.equal(plugin.settings.krispAutoImport, false);
  assert.equal(plugin.settings.aiIncludeInstructions, true);
  assert.equal(plugin.settings.aiInstructions, "");
  assert.equal(plugin.settings.aiSaveProperties, true);
});

test("Copy meeting for AI assistant leaves out the instructions when switched off, and uses custom ones", async () => {
  const app = createMemoryApp([
    { path: "Clients/Acme/Sync.md", content: "---\ntitle: \"Sync\"\ndate: 2026-04-02\nstart: 2026-04-02T10:00\nend: 2026-04-02T10:30\ncalendar_event_id: \"sync\"\n---\n\n## Notes\n\n- Mine\n\n## Transcript\n\n" },
  ]);
  const plugin = createPlugin(app);
  plugin.settings = appleSettings();
  const file = app.files.get("Clients/Acme/Sync.md") as never;

  assert.match(await plugin.assistantCopyText(file) ?? "", /^Write up the meeting below[\s\S]*\n\nMEETING DETAILS\nTitle: Sync\nDate: 2026-04-02\nTime: /);
  plugin.settings.aiInstructions = "Be brief.";
  assert.match(await plugin.assistantCopyText(file) ?? "", /^Be brief\.\n\nMEETING DETAILS\n/);
  plugin.settings.aiIncludeInstructions = false;
  assert.match(await plugin.assistantCopyText(file) ?? "", /^MEETING DETAILS\n/);
});

test("Add AI reply files an agent report into a filed note and rejects unrelated text", async () => {
  const app = createMemoryApp([
    { path: "Clients/Acme/2026/Sync.md", content: "---\ntitle: \"Sync\"\ncalendar_event_id: \"sync\"\n---\n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] \n\n## Meeting Summary\n\n\n\n## Transcript\n\n" },
  ]);
  const plugin = createPlugin(app);
  plugin.settings = appleSettings();
  const file = app.files.get("Clients/Acme/2026/Sync.md") as TFile;
  const report = "**Category:** Team Sync\n**Primary Account / Project:** General\n**Key Decisions Made:**\n- Ship it\n### Action Items & Commitments\n| Action Item | Owner | Due |\n|---|---|---|\n| Write notes | Alice Smith | 2026-04-10 |";

  assert.equal(await plugin.applyAssistantReply(file as never, report), true);
  assert.match(file.content ?? "", /## Action items\n\n- \[ \] Write notes @\[\[Alice Smith\]\] 📅 2026-04-10\n/);
  assert.match(file.content ?? "", /^meeting_category: "Team Sync"$/m);
  assert.doesNotMatch(file.content ?? "", /^account:/m, "General is not an account");
  assert.match(getNotices().at(-1)?.message ?? "", /Updated the summary; added 1 new decision and 1 new action item/);

  const before = file.content;
  assert.equal(await plugin.applyAssistantReply(file as never, "Hello there"), false);
  assert.equal(file.content, before);
});
