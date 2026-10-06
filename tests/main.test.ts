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

function createPlugin(app?: App): GoogleCalendarPlugin {
  return new GoogleCalendarPlugin(
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
    ({ listEventsInTimeWindow: async () => [original] } as never);
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
    ({ listEventsInTimeWindow: async () => [moved] } as never);
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
    ({ listEventsInTimeWindow: async () => [buildEvent({ id: "a", summary: "Kept" })] } as never);
  await plugin.refreshNotes(false);

  plugin.getCalendarService = async () =>
    ({
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
    ({ listEventsInTimeWindow: async () => [buildEvent({ id: "deleted", summary: "Back" })] } as never);

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
    ({ listEventsInTimeWindow: async () => [buildEvent({ id: "same", summary: "Same" })] } as never);
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
    ({ listEventsInTimeWindow: async () => [buildEvent({ id: "t", summary: "Templated" })] } as never);

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
    ({ listEventsInTimeWindow: async () => [buildEvent({ id: "m", summary: "Fallback" })] } as never);

  await plugin.refreshNotes(true);

  const content = (app.files.get("Meeting Notes/2026-04-03 - Fallback.md") as TFile).content ?? "";
  assert.match(content, /^> \[!info\] Meeting details$/m);
  assert.doesNotMatch(content, /daily_note/);
  assert.ok(getNotices().some((n) => /template "Templates\/Missing\.md" not found/.test(n.message)));
});
