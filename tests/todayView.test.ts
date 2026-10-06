import test from "node:test";
import assert from "node:assert/strict";
import { todayRows } from "../src/todayView";
import { buildEvent } from "./support/testHelpers";

const at = (id: string, start: string, end: string, extra = {}) =>
  buildEvent({ id, summary: id, start: { dateTime: start }, end: { dateTime: end }, ...extra });

test("todayRows lists today's timed meetings in order, marked done / now / upcoming", () => {
  const now = new Date("2026-10-06T11:15:00-04:00");
  const rows = todayRows([
    at("afternoon", "2026-10-06T15:00:00-04:00", "2026-10-06T16:00:00-04:00"),
    at("standup", "2026-10-06T09:00:00-04:00", "2026-10-06T09:15:00-04:00"),
    at("review", "2026-10-06T11:00:00-04:00", "2026-10-06T12:00:00-04:00"),
    at("tomorrow", "2026-10-07T09:00:00-04:00", "2026-10-07T10:00:00-04:00"),
    at("yesterday", "2026-10-05T09:00:00-04:00", "2026-10-05T10:00:00-04:00"),
    at("cancelled", "2026-10-06T13:00:00-04:00", "2026-10-06T14:00:00-04:00", { cancelled: true }),
    buildEvent({ id: "holiday", start: { date: "2026-10-06" }, end: { date: "2026-10-07" } }),
  ], now);

  assert.deepEqual(rows.map((r) => [r.event.id, r.state]), [
    ["standup", "done"],
    ["review", "now"],
    ["afternoon", "upcoming"],
  ]);
});

test("todayRows includes a meeting that started last night and runs into today", () => {
  const now = new Date("2026-10-06T00:30:00-04:00");
  const rows = todayRows([at("late", "2026-10-05T23:30:00-04:00", "2026-10-06T01:00:00-04:00")], now);
  assert.deepEqual(rows.map((r) => [r.event.id, r.state]), [["late", "now"]]);
});
