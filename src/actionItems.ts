/**
 * @file actionItems.ts
 * @description The "Meeting action items" sidebar view: every open task in
 * the plugin's meeting notes, grouped by meeting, newest first. Ticking an
 * item checks it off in its meeting note.
 */

import { App, debounce, ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { findNotesByEventId, openTasks, OpenTask } from "./noteCreator";

export const ACTION_ITEMS_VIEW = "calendar-notes-action-items";

export interface MeetingTasks {
  file: TFile;
  title: string;
  start: string;
  tasks: OpenTask[];
}

/** Meeting notes under `noteFolder` that have open tasks, newest first. */
export async function collectOpenItems(app: App, noteFolder: string): Promise<MeetingTasks[]> {
  const meetings: MeetingTasks[] = [];
  for (const file of findNotesByEventId(app, noteFolder).values()) {
    const tasks = openTasks(await app.vault.cachedRead(file));
    if (tasks.length === 0) continue;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    meetings.push({
      file,
      title: typeof fm.title === "string" && fm.title ? fm.title : file.basename,
      start: String(fm.start ?? fm.date ?? ""),
      tasks,
    });
  }
  return meetings.sort((a, b) => b.start.localeCompare(a.start));
}

/**
 * Check off an open task in its note. The task is looked up by text if its
 * line moved since it was listed. Returns false if it is no longer open.
 */
export async function completeTask(app: App, file: TFile, task: OpenTask): Promise<boolean> {
  let done = false;
  await app.vault.process(file, (content) => {
    const lines = content.split("\n");
    const isTask = (i: number) => openTasks(lines[i] ?? "").some((t) => t.text === task.text);
    const index = isTask(task.line) ? task.line : lines.findIndex((_, i) => isTask(i));
    if (index === -1) return content;
    lines[index] = lines[index].replace("[ ]", "[x]");
    done = true;
    return lines.join("\n");
  });
  return done;
}

export class ActionItemsView extends ItemView {
  private readonly refresh = debounce(() => this.render(), 500, true);

  constructor(leaf: WorkspaceLeaf, private readonly noteFolder: () => string) {
    super(leaf);
  }

  getViewType(): string {
    return ACTION_ITEMS_VIEW;
  }

  getDisplayText(): string {
    return "Meeting action items";
  }

  getIcon(): string {
    return "list-checks";
  }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.metadataCache.on("changed", () => this.refresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.refresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.refresh()));
    await this.render();
  }

  async render(): Promise<void> {
    const meetings = await collectOpenItems(this.app, this.noteFolder());
    const el = this.contentEl;
    el.empty();
    el.addClass("cal-notes-action-items");
    el.createEl("h4", { text: "Open action items" });
    if (meetings.length === 0) {
      el.createDiv({ cls: "cal-notes-empty", text: "No open action items in your meeting notes." });
      return;
    }

    for (const meeting of meetings) {
      const group = el.createDiv({ cls: "cal-notes-meeting" });
      const heading = group.createEl("a", { cls: "cal-notes-meeting-title", text: meeting.title });
      heading.addEventListener("click", () => this.app.workspace.getLeaf(false).openFile(meeting.file));
      if (meeting.start) group.createDiv({ cls: "cal-notes-meeting-date", text: meeting.start.replace("T", " ") });

      const list = group.createEl("ul", { cls: "contains-task-list" });
      for (const task of meeting.tasks) {
        const item = list.createEl("li", { cls: "task-list-item" });
        const box = item.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
        item.createSpan({ text: task.text });
        box.addEventListener("change", async () => {
          box.disabled = true;
          await completeTask(this.app, meeting.file, task);
          await this.render();
        });
      }
    }
  }
}
