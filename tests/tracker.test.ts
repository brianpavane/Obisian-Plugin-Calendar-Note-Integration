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

  assert.match(content, /\| 3 \| 1 \| 1 \| 1 \| 2 \|/);
  assert.match(content, /## Overdue\n\n- Confirm window \(owner: Customer IT team\) · 📅 2026-10-01 · \[\[Clients\/Acme\/Pilot review\|Pilot review\]\]\n/);
  assert.match(content, /## Due in the next 7 days\n\n- Send scope @\[\[Bob Jones\]\] · ⏫ 📅 2026-10-09 ·/);
  assert.match(content, /### Acme Corp \(2\)[\s\S]*### No account \(1\)\n\n- Book room · \[\[Team\/Sync\|Sync\]\]/);
  assert.match(content, /### Bob Jones \(1\)[\s\S]*### Customer IT team \(1\)[\s\S]*### Unassigned \(1\)/);
  assert.match(content, /## Decisions in the last 30 days\n\n### \[\[Clients\/Acme\/Pilot review\|Pilot review\]\] · 2026-10-06\n\n- Move to a production pilot\n/);
  assert.doesNotMatch(content, /Too old to list/);
  assert.match(content, /## Meetings this week \(2026-10-05 to 2026-10-11\)\n\n\| Category \| Meetings \|\n\| --- \| --- \|\n\| External Customer \(1\) \| \[\[Clients\/Acme\/Pilot review\\\|Pilot review\]\] \|\n\| Team Sync \(1\) \| \[\[Team\/Sync\\\|Sync\]\] \|/);
  assert.doesNotMatch(content, /- \[ \]/, "no checkboxes, so items are never counted twice");
});

test("buildTracker says so when there is nothing to show", () => {
  const content = buildTracker([], "2026-10-07", "now");
  assert.match(content, /\| 0 \| 0 \| 0 \| 0 \| 0 \|/);
  assert.equal(content.match(/Nothing here\./g)?.length, 7);
});
