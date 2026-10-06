import test from "node:test";
import assert from "node:assert/strict";
import { parseJxaEvents } from "../src/appleCalendarApi";

function raw(overrides: Record<string, unknown>) {
  return {
    uid: "SERIES-1",
    summary: "Weekly 1:1",
    calendarName: "Work",
    startDate: "2026-01-15T15:00:00.000Z",
    endDate: "2026-01-15T15:30:00.000Z",
    allDayEvent: false,
    description: "",
    location: "",
    ...overrides,
  };
}

test("parseJxaEvents gives each occurrence of a recurring event its own id", () => {
  const events = parseJxaEvents(
    JSON.stringify([
      raw({ recurring: true, occurrenceDate: "2026-01-15T15:00:00.000Z" }),
      raw({
        recurring: true,
        occurrenceDate: "2026-01-22T15:00:00.000Z",
        startDate: "2026-01-22T15:00:00.000Z",
        endDate: "2026-01-22T15:30:00.000Z",
      }),
    ]),
    []
  );

  assert.deepEqual(events.map((e) => e.id), [
    "SERIES-1::2026-01-15T15:00:00.000Z",
    "SERIES-1::2026-01-22T15:00:00.000Z",
  ]);
});

test("parseJxaEvents keeps a moved occurrence's id stable via its original date", () => {
  const [event] = parseJxaEvents(
    JSON.stringify([
      raw({
        recurring: true,
        occurrenceDate: "2026-01-22T15:00:00.000Z",
        startDate: "2026-01-23T17:00:00.000Z",
        endDate: "2026-01-23T17:30:00.000Z",
      }),
    ]),
    []
  );

  assert.equal(event.id, "SERIES-1::2026-01-22T15:00:00.000Z");
  assert.equal(event.start.dateTime, "2026-01-23T17:00:00.000Z");
});

test("parseJxaEvents keeps plain ids for one-off events and reads calendar details", () => {
  const [event] = parseJxaEvents(
    JSON.stringify([raw({ uid: "ONE-OFF", status: 3, url: "https://zoom.us/j/987654321" })]),
    []
  );

  assert.equal(event.id, "ONE-OFF");
  assert.equal(event.calendarName, "Work");
  assert.equal(event.cancelled, true);
  assert.equal(event.conferenceData?.entryPoints?.[0].uri, "https://zoom.us/j/987654321");
  assert.equal(event.conferenceData?.conferenceSolution?.name, "Zoom");
});

test("parseJxaEvents finds join links in the location and gives id-less events a stable id", () => {
  const json = JSON.stringify([
    raw({ uid: "", location: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0" }),
  ]);
  const [first] = parseJxaEvents(json, []);
  const [second] = parseJxaEvents(json, []);

  assert.equal(first.conferenceData?.conferenceSolution?.name, "Microsoft Teams");
  assert.equal(first.id, second.id);
  assert.equal(first.cancelled, undefined);
});
