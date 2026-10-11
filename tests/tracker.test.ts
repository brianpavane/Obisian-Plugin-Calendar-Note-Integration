import test from "node:test";
import assert from "node:assert/strict";
import { parseTaskMeta } from "../src/actionItems";
import { buildTracker, type TrackerMeeting } from "../src/tracker";

const meeting = (path: string, date: string, extra: Partial<TrackerMeeting> = {}): TrackerMeeting => ({
  path, title: path.split("/").pop() ?? path, date, openItems: [], doneItems: [], decisions: [], ...extra,
});

test("buildTracker summarizes open items, decisions and this week's meetings", () => {
  const content = buildTracker([
    meeting("Clients/Acme/Pilot review", "2026-10-06", {
      account: "Acme Corp",
      category: "External Customer",
      openItems: [
        parseTaskMeta("Send scope @[[Bob Jones]] ⏫ 📅 2026-10-09"),
        parseTaskMeta("Confirm window (owner: Customer IT team) 📅 2026-10-01"),
      ],
      decisions: ["Move to a production pilot"],
    }),
    meeting("Team/Sync", "2026-10-07", { category: "Team Sync", openItems: [parseTaskMeta("Book room")] }),
    meeting("Old/Kickoff", "2026-08-01", { decisions: ["Too old to list"] }),
  ], "2026-10-07", "2026-10-07 9:00 AM");

  assert.match(content, /\| 3 \| 1 \| 1 \| 1 \| 0 \| 0 \| 2 \|/);
  assert.match(content, /## Overdue\n\n- \[ \] Confirm window \(owner: Customer IT team\) · 📅 2026-10-01 · \[\[Clients\/Acme\/Pilot review\|Pilot review\]\]\n/);
  assert.match(content, /## Due in the next 7 days\n\n- \[ \] Send scope @\[\[Bob Jones\]\] · ⏫ 📅 2026-10-09 ·/);
  assert.match(content, /### Acme Corp \(2\)[\s\S]*### No account \(1\)\n\n- \[ \] Book room · \[\[Team\/Sync\|Sync\]\]/);
  assert.match(content, /## Waiting on others\n\nSet \*\*Your name\*\*/, "without names every item is the user's");
  assert.match(content, /## Decisions in the last 30 days\n\n### \[\[Clients\/Acme\/Pilot review\|Pilot review\]\] · 2026-10-06\n\n- Move to a production pilot\n/);
  assert.doesNotMatch(content, /Too old to list/);
  assert.match(content, /## Meetings this week \(2026-10-05 to 2026-10-11\)\n\n\| Category \| Meetings \|\n\| --- \| --- \|\n\| External Customer \(1\) \| \[\[Clients\/Acme\/Pilot review\\\|Pilot review\]\] \|\n\| Team Sync \(1\) \| \[\[Team\/Sync\\\|Sync\]\] \|/);
});

test("buildTracker says so when there is nothing to show", () => {
  const content = buildTracker([], "2026-10-07", "now");
  assert.match(content, /\| 0 \| 0 \| 0 \| 0 \| 0 \| 0 \| 0 \|/);
  assert.equal(content.match(/Nothing here\./g)?.length, 7);
});

test("buildTracker leaves cancelled, removed and declined meetings out of this week's meetings but keeps their items", () => {
  const content = buildTracker([
    meeting("Team/Sync", "2026-10-06", { category: "Team Sync" }),
    meeting("Team/Skipped sync", "2026-10-07", { category: "Team Sync", skipped: true, openItems: [parseTaskMeta("Reschedule demo")] }),
  ], "2026-10-07", "now");

  assert.match(content, /\| Team Sync \(1\) \| \[\[Team\/Sync\\\|Sync\]\] \|/);
  assert.doesNotMatch(content, /\| [^\n]*Skipped sync\\\|/);
  assert.match(content, /- \[ \] Reschedule demo · \[\[Team\/Skipped sync\|Skipped sync\]\]/);
});

test("buildTracker puts the user's items first: Focus, then their own lists, Waiting on others and Gone stale?", () => {
  const content = buildTracker([
    meeting("Clients/Acme/Pilot", "2026-10-06", {
      account: "Acme", sentiment: "Negative",
      openItems: [
        parseTaskMeta("Fix certs @[[Brian Pavane]]"),
        parseTaskMeta("Send runbook @[[Danny Ward]] 📅 2026-10-01"),
      ],
    }),
    meeting("Team/Sync", "2026-10-05", {
      openItems: [
        parseTaskMeta("Late report 📅 2026-10-02"),
        parseTaskMeta("Plan offsite 📅 2026-10-12"),
        parseTaskMeta("Hire contractor ⏫"),
        parseTaskMeta("Tidy wiki"),
      ],
    }),
    meeting("Old/Kickoff", "2026-08-01", { openItems: [parseTaskMeta("Old idea"), parseTaskMeta("Ask Bob @Bob")] }),
  ], "2026-10-08", "now", ["Brian Pavane"]);

  const section = (name: string) => content.split(`## ${name}`)[1]?.split("\n## ")[0] ?? "";
  const focus = section("Focus");
  const order = ["Late report", "Plan offsite", "Hire contractor", "Fix certs", "Tidy wiki"];
  assert.deepEqual(order.map((t) => focus.indexOf(t)).every((i, n, all) => i > 0 && (n === 0 || all[n - 1] < i)), true, focus);
  assert.match(focus, /- \[ \] Late report · 📅 2026-10-02 · \[\[Team\/Sync\|Sync\]\] · \*overdue\*/);
  assert.match(focus, /Fix certs @\[\[Brian Pavane\]\] · \[\[Clients\/Acme\/Pilot\|Pilot\]\] · \*at-risk account\*/);
  assert.doesNotMatch(focus, /Danny|Old idea/, "others' items and stale ones aren't in Focus");
  assert.doesNotMatch(section("Overdue"), /Send runbook/, "Overdue lists only the user's items");
  assert.match(section("Waiting on others"), /### Bob \(1\)[\s\S]*### Danny Ward \(1\)\n\n- \[ \] Send runbook [^\n]+ · \*overdue\*/);
  assert.match(section("Gone stale?"), /Tick one here to drop it[\s\S]*- \[ \] Old idea ·[\s\S]*- \[ \] Ask Bob/);
  assert.doesNotMatch(section("Gone stale?"), /Tidy wiki/);
  assert.match(content, /\| 6 \| 1 \| 1 \| 1 \| 2 \| 2 \| 2 \|/);
});
