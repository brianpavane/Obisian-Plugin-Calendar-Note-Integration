import test from "node:test";
import assert from "node:assert/strict";
import { parseIcal } from "../src/icalParser";

test("parseIcal assigns unique ids to recurring instances", () => {
  const events = parseIcal(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:series-123
SUMMARY:Weekly Sync
DTSTART:20260403T140000Z
DTEND:20260403T150000Z
END:VEVENT
BEGIN:VEVENT
UID:series-123
RECURRENCE-ID:20260410T140000Z
SUMMARY:Weekly Sync
DTSTART:20260410T140000Z
DTEND:20260410T150000Z
END:VEVENT
END:VCALENDAR`);

  assert.equal(events.length, 2);
  assert.equal(events[0].id, "series-123::2026-04-03T14:00:00Z");
  assert.equal(events[1].id, "series-123::2026-04-10T14:00:00Z");
});

test("parseIcal converts TZID datetimes to UTC", () => {
  const [event] = parseIcal(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:tzid-1
SUMMARY:Timezone Test
DTSTART;TZID=America/New_York:20260115T100000
DTEND;TZID=America/New_York:20260115T110000
END:VEVENT
END:VCALENDAR`);

  assert.ok(event);
  assert.equal(event.start.dateTime, "2026-01-15T15:00:00Z");
  assert.equal(event.end.dateTime, "2026-01-15T16:00:00Z");
});

test("parseIcal keeps unknown TZID values as floating local timestamps", () => {
  const [event] = parseIcal(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:tzid-unknown
SUMMARY:Fallback Test
DTSTART;TZID=Custom/Zone:20260115T100000
DTEND;TZID=Custom/Zone:20260115T110000
END:VEVENT
END:VCALENDAR`);

  assert.ok(event);
  assert.equal(event.start.dateTime, "2026-01-15T10:00:00");
  assert.equal(event.end.dateTime, "2026-01-15T11:00:00");
});
