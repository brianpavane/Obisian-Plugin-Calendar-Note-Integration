/**
 * @file actionItems.ts
 * @description The "Meeting action items" sidebar view: every open task in
 * the plugin's meeting notes, grouped by meeting, person, or due date.
 * Ticking an item checks it off in its meeting note.
 *
 * Tasks may name an owner (`@Bob`, `@[[Bob Jones]]`, or `(owner: IT team)`),
 * a due date and a priority in the Tasks plugin's formats (`📅 2026-10-10` or
 * `[due:: 2026-10-10]`; ⏫ high, 🔼 medium, 🔽 low). Ticking a task adds the
 * Tasks plugin's done date (`✅ 2026-10-07`).
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

export type Priority = "highest" | "high" | "medium" | "low" | "lowest";

export interface TaskMeta {
  /** Task text without the due date, priority and created/done date markers. */
  text: string;
  owner?: string;
  due?: string;
  priority?: Priority;
  /** The Tasks plugin's done date (`✅ 2026-10-08`), if the task has one. */
  doneOn?: string;
  /** The Tasks plugin's created date (`➕ 2026-10-08`), if the task has one. */
  created?: string;
}

const DUE_RE = /\s*(?:📅\s*(\d{4}-\d{2}-\d{2})|\[due::\s*(\d{4}-\d{2}-\d{2})\s*\])/u;
const OWNER_RE = /(?:^|\s)@(?:\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|([\p{L}\p{N}_.-]+))/u;
const ROLE_OWNER_RE = /\(owner:\s*([^)]+)\)/i;
const PRIORITY_MARKS: Array<[RegExp, Priority]> = [
  [/🔺/u, "highest"],
  [/⏫|\(priority:\s*high\)/iu, "high"],
  [/🔼|\(priority:\s*medium\)/iu, "medium"],
  [/🔽|\(priority:\s*low\)/iu, "low"],
  [/⏬/u, "lowest"],
];
const OTHER_MARKS_RE = /\s*(?:[🔺⏫🔼🔽⏬]|\(priority:\s*\w+\)|(?:➕|✅|⏳|🛫)\s*\d{4}-\d{2}-\d{2})/giu;

/** Owner, due date and priority written in a task's text. */
export function parseTaskMeta(text: string): TaskMeta {
  const due = text.match(DUE_RE);
  const person = text.match(OWNER_RE);
  const role = text.match(ROLE_OWNER_RE);
  const doneOn = text.match(/✅\s*(\d{4}-\d{2}-\d{2})/u)?.[1];
  const created = text.match(/➕\s*(\d{4}-\d{2}-\d{2})/u)?.[1];
  return {
    text: text.replace(DUE_RE, "").replace(OTHER_MARKS_RE, "").replace(/\s+/g, " ").trim(),
    owner: person ? (person[1] ?? person[2]).trim() : role?.[1].trim(),
    due: due ? due[1] ?? due[2] : undefined,
    priority: PRIORITY_MARKS.find(([re]) => re.test(text))?.[1],
    ...(doneOn ? { doneOn } : {}),
    ...(created ? { created } : {}),
  };
}

const PRIORITY_RANK: Record<Priority, number> = { highest: 0, high: 1, medium: 2, low: 4, lowest: 5 };
/** Sort key: no priority ranks between medium and low, as in the Tasks plugin. */
export const priorityRank = (p: Priority | undefined) => (p ? PRIORITY_RANK[p] : 3);

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
  const byDue = (a: ItemRow, b: ItemRow) =>
    priorityRank(a.meta.priority) - priorityRank(b.meta.priority) ||
    (a.meta.due ?? "9999").localeCompare(b.meta.due ?? "9999");

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

/** Meeting notes anywhere in the vault that have open tasks, newest first. */
export async function collectOpenItems(app: App): Promise<MeetingTasks[]> {
  const meetings: MeetingTasks[] = [];
  for (const file of findNotesByEventId(app).values()) {
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
 * Check off an open task in its note, adding the Tasks plugin's done date
 * (`✅ done`) when given. The task is looked up by text if its line moved
 * since it was listed. Returns false if it is no longer open.
 */
export async function completeTask(app: App, file: TFile, task: OpenTask, done?: string): Promise<boolean> {
  let completed = false;
  await app.vault.process(file, (content) => {
    const lines = content.split("\n");
    const isTask = (i: number) => openTasks(lines[i] ?? "").some((t) => t.text === task.text);
    const index = isTask(task.line) ? task.line : lines.findIndex((_, i) => isTask(i));
    if (index === -1) return content;
    lines[index] = lines[index].replace("[ ]", "[x]").replace(/\s*$/, done ? ` ✅ ${done}` : "");
    completed = true;
    return lines.join("\n");
  });
  return completed;
}

/** A date as YYYY-MM-DD in this machine's time zone. */
export function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export class ActionItemsView extends ItemView {
  private readonly refresh = debounce(() => this.render(), 500, true);
  private groupBy: GroupBy = "meeting";

  constructor(leaf: WorkspaceLeaf) {
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
    const meetings = await collectOpenItems(this.app);
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
        if (row.meta.priority) {
          const label = row.meta.priority[0].toUpperCase() + row.meta.priority.slice(1);
          details.createSpan({ cls: `cal-notes-priority is-${row.meta.priority}`, text: label });
        }
        if (row.meta.due) {
          details.createSpan({ cls: row.overdue ? "cal-notes-due is-overdue" : "cal-notes-due", text: `📅 ${row.meta.due}` });
        }
        if (!group.meeting) {
          const source = details.createEl("a", { text: row.meeting.title });
          source.addEventListener("click", () => this.app.workspace.getLeaf(false).openFile(row.meeting.file));
        }
        box.addEventListener("change", async () => {
          box.disabled = true;
          await completeTask(this.app, row.meeting.file, row.task, localDate(new Date()));
          await this.render();
        });
      }
    }
  }
}
