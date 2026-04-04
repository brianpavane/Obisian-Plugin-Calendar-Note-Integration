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
    includeConferenceLinks: null,
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
  assert.equal(plugin.settings.includeConferenceLinks, false);
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
  assert.match(getNotices().at(-1)?.message ?? "", /Created 1 new note/);
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
  assert.match(getNotices().at(-1)?.message ?? "", /Rebuilt 1 note/);
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
