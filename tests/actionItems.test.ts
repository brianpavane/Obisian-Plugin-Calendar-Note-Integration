import test from "node:test";
import assert from "node:assert/strict";
import { collectOpenItems, completeTask } from "../src/actionItems";
import { TFile } from "./support/obsidianStub";
import { createMemoryApp } from "./support/testHelpers";

const note = (title: string, start: string, body: string) =>
  `---\ntitle: "${title}"\nstart: ${start}\ncalendar_event_id: "${title}"\n---\n\n## Action items\n\n${body}`;

test("collectOpenItems lists open tasks from meeting notes, newest meeting first", async () => {
  const app = createMemoryApp([
    { path: "Meetings/2026-01-08 - Sync.md", content: note("Sync", "2026-01-08T10:00", "- [ ] Send deck\n- [x] Book room\n- [ ] ") },
    { path: "Meetings/2026-01-15 - Review.md", content: note("Review", "2026-01-15T10:00", "- [ ] Draft plan") },
    { path: "Meetings/2026-01-20 - Done.md", content: note("Done", "2026-01-20T10:00", "- [x] All done\n- [ ] ") },
    { path: "Other/Todo.md", content: "- [ ] Not a meeting" },
  ]);

  const meetings = await collectOpenItems(app as never, "Meetings");
  assert.deepEqual(
    meetings.map((m) => [m.title, m.start, m.tasks.map((t) => t.text)]),
    [
      ["Review", "2026-01-15T10:00", ["Draft plan"]],
      ["Sync", "2026-01-08T10:00", ["Send deck"]],
    ]
  );
});

test("completeTask checks off the task, finding it by text if its line moved", async () => {
  const app = createMemoryApp([
    { path: "Meetings/Sync.md", content: "## Action items\n\n- [ ] Send deck\n- [ ] Draft plan" },
  ]);
  const file = app.files.get("Meetings/Sync.md") as TFile;

  assert.equal(await completeTask(app as never, file as never, { line: 3, text: "Draft plan" }), true);
  assert.equal(file.content, "## Action items\n\n- [ ] Send deck\n- [x] Draft plan");

  file.content = "## Notes\n\n## Action items\n\n- [ ] Send deck\n- [x] Draft plan";
  assert.equal(await completeTask(app as never, file as never, { line: 2, text: "Send deck" }), true);
  assert.equal(file.content, "## Notes\n\n## Action items\n\n- [x] Send deck\n- [x] Draft plan");

  assert.equal(await completeTask(app as never, file as never, { line: 4, text: "Send deck" }), false);
});
