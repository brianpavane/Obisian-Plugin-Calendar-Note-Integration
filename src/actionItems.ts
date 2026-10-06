/**
 * @file actionItems.ts
 * @description The "Meeting action items" sidebar view: every open task in
 * the plugin's meeting notes, grouped by meeting, person, or due date.
 * Ticking an item checks it off in its meeting note.
 *
 * Tasks may name an owner (`@Bob`, `@[[Bob Jones]]`) and a due date in the
 * Tasks plugin's formats (`📅 2026-10-10` or `[due:: 2026-10-10]`).
 */

import { App, debounce, ItemView, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { findNotesByEventId, openTasks, OpenTask } from "./noteCreator";

export const ACTION_ITEMS_VIEW = "calendar-notes-action-items";

export interface MeetingTasks {
  file: TFile;
  title: string;
  start: string;
  tasks: OpenTask[];
}

export interface TaskMeta {
  /** Task text without the due-date marker. */
  text: string;
  owner?: string;
  due?: string;
}

const DUE_RE = /\s*(?:📅\s*(\d{4}-\d{2}-\d{2})|\[due::\s*(\d{4}-\d{2}-\d{2})\s*\])/u;
const OWNER_RE = /(?:^|\s)@(?:\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|([\p{L}\p{N}_.-]+))/u;

/** Owner and due date written in a task's text. */
export function parseTaskMeta(text: string): TaskMeta {
  const due = text.match(DUE_RE);
  const owner = text.match(OWNER_RE);
  return {
    text: due ? text.replace(DUE_RE, "").trim() : text,
    owner: owner ? (owner[1] ?? owner[2]).trim() : undefined,
    due: due ? due[1] ?? due[2] : undefined,
  };
}

export type GroupBy = "meeting" | "person" | "due";

export interface ItemRow {
  meeting: MeetingTasks;
  task: OpenTask;
  meta: TaskMeta;
  overdue: boolean;
}

export interface ItemGroup {
  label: string;
  /** Set when the group is a single meeting, so its heading can open the note. */
  meeting?: MeetingTasks;
  rows: ItemRow[];
}

const DUE_BUCKETS = ["Overdue", "Today", "Next 7 days", "Later", "No due date"] as const;

function dueBucket(due: string | undefined, today: string, weekAhead: string): typeof DUE_BUCKETS[number] {
  if (!due) return "No due date";
  if (due < today) return "Overdue";
  if (due === today) return "Today";
  return due <= weekAhead ? "Next 7 days" : "Later";
}

/**
 * Group open items for display. `today` is the local date (YYYY-MM-DD).
 * By meeting: newest meeting first. By person: alphabetical, unassigned last.
 * By due date: overdue first, then soonest; undated last.
 */
export function groupItems(meetings: MeetingTasks[], groupBy: GroupBy, today: string): ItemGroup[] {
  const rows: ItemRow[] = meetings.flatMap((meeting) => meeting.tasks.map((task) => {
    const meta = parseTaskMeta(task.text);
    return { meeting, task, meta, overdue: meta.due !== undefined && meta.due < today };
  }));
  const byDue = (a: ItemRow, b: ItemRow) => (a.meta.due ?? "9999").localeCompare(b.meta.due ?? "9999");

  if (groupBy === "meeting") {
    return meetings.map((meeting) => ({
      label: meeting.title,
      meeting,
      rows: rows.filter((r) => r.meeting === meeting),
    }));
  }

  const groups = new Map<string, ItemRow[]>();
  const week = new Date(`${today}T12:00:00`);
  week.setDate(week.getDate() + 7);
  const weekAhead = localDate(week);
  for (const row of rows) {
    const key = groupBy === "person" ? row.meta.owner ?? "" : dueBucket(row.meta.due, today, weekAhead);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const keys = groupBy === "person"
    ? [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    : DUE_BUCKETS.filter((k) => groups.has(k));
  return keys.map((key) => ({
    label: groupBy === "person" ? key || "Unassigned" : key,
    rows: [...(groups.get(key) ?? [])].sort(byDue),
  }));
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

function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export class ActionItemsView extends ItemView {
  private readonly refresh = debounce(() => this.render(), 500, true);
  private groupBy: GroupBy = "meeting";

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

  getState(): Record<string, unknown> {
    return { ...super.getState(), groupBy: this.groupBy };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const groupBy = (state as { groupBy?: unknown } | null)?.groupBy;
    if (groupBy === "meeting" || groupBy === "person" || groupBy === "due") {
      this.groupBy = groupBy;
      await this.render();
    }
    await super.setState(state, result);
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

    const header = el.createDiv({ cls: "cal-notes-header" });
    header.createEl("h4", { text: "Open action items" });
    const select = header.createEl("select", { cls: "dropdown" });
    for (const [value, label] of [["meeting", "By meeting"], ["person", "By person"], ["due", "By due date"]] as const) {
      select.createEl("option", { value, text: label });
    }
    select.value = this.groupBy;
    select.addEventListener("change", async () => {
      this.groupBy = select.value as GroupBy;
      this.app.workspace.requestSaveLayout();
      await this.render();
    });

    if (meetings.length === 0) {
      el.createDiv({ cls: "cal-notes-empty", text: "No open action items in your meeting notes." });
      return;
    }

    for (const group of groupItems(meetings, this.groupBy, localDate(new Date()))) {
      const block = el.createDiv({ cls: "cal-notes-meeting" });
      if (group.meeting) {
        const meeting = group.meeting;
        const heading = block.createEl("a", { cls: "cal-notes-meeting-title", text: group.label });
        heading.addEventListener("click", () => this.app.workspace.getLeaf(false).openFile(meeting.file));
        if (meeting.start) block.createDiv({ cls: "cal-notes-meeting-date", text: meeting.start.replace("T", " ") });
      } else {
        block.createDiv({ cls: "cal-notes-meeting-title", text: `${group.label} (${group.rows.length})` });
      }

      const list = block.createEl("ul", { cls: "contains-task-list" });
      for (const row of group.rows) {
        const item = list.createEl("li", { cls: "task-list-item" });
        const box = item.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
        const body = item.createDiv({ cls: "cal-notes-item" });
        body.createSpan({ text: row.meta.text });
        const details = body.createDiv({ cls: "cal-notes-item-meta" });
        if (row.meta.due) {
          details.createSpan({ cls: row.overdue ? "cal-notes-due is-overdue" : "cal-notes-due", text: `📅 ${row.meta.due}` });
        }
        if (!group.meeting) {
          const source = details.createEl("a", { text: row.meeting.title });
          source.addEventListener("click", () => this.app.workspace.getLeaf(false).openFile(row.meeting.file));
        }
        box.addEventListener("change", async () => {
          box.disabled = true;
          await completeTask(this.app, row.meeting.file, row.task);
          await this.render();
        });
      }
    }
  }
}
