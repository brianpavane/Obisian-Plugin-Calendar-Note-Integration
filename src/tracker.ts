/**
 * @file tracker.ts
 * @description The Meeting Tracker note: a snapshot of open action items,
 * recent decisions and this week's meetings across every meeting note,
 * rebuilt by the "Open meeting tracker" command. Items are listed as plain
 * bullets, not checkboxes, so they are never counted twice as tasks.
 */

import { priorityRank, type TaskMeta } from "./actionItems";

export const TRACKER_FILENAME = "Meeting Tracker.md";

export interface TrackerMeeting {
  /** Vault path without `.md`, for links. */
  path: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  account?: string;
  category?: string;
  openItems: TaskMeta[];
  /** Ticked items (with their done date, if they have one). */
  doneItems: TaskMeta[];
  decisions: string[];
  /** The meeting was cancelled, removed from the calendar or declined. */
  skipped?: boolean;
  /** The note's `status` property (e.g. "cancelled"), if any. */
  status?: string;
  /** The meeting's calendar event id. */
  id?: string;
  /** Length in minutes, from the note's start and end. */
  minutes?: number;
  /** Properties from the AI reply's Meeting Metadata. */
  sentiment?: string;
  outcome?: string;
  keyTopics?: string[];
  organizations?: string[];
  /** Attendees and identified speakers, by name. */
  people?: string[];
  /** An AI reply has been filed into the note (`ai_summarized`). */
  summarized?: boolean;
  /** The note's "Core Elements for Next Meeting Continuity" bullets. */
  continuity?: string[];
}

/** "Where we left off": the continuity points of the latest meeting held that has some. */
export function leftOff(meetings: TrackerMeeting[], today: string): string[] {
  const latest = meetings
    .filter((m) => !m.skipped && m.date && m.date <= today && (m.continuity?.length ?? 0) > 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return latest ? [`From ${link(latest)} · ${latest.date}:`, "", ...latest.continuity!.map((c) => `- ${c}`)] : ["Nothing here."];
}

export interface Item {
  meta: TaskMeta;
  meeting: TrackerMeeting;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function link(meeting: TrackerMeeting, inTable = false): string {
  const alias = meeting.title.replace(/[[\]|#^]/g, " ").replace(/\s+/g, " ").trim() || meeting.path;
  return `[[${meeting.path}${inTable ? "\\|" : "|"}${alias}]]`;
}

const PRIORITY_MARK: Record<string, string> = { highest: "🔺", high: "⏫", medium: "🔼", low: "🔽", lowest: "⏬" };

function itemLine({ meta, meeting }: Item): string {
  const extras = [
    meta.priority ? PRIORITY_MARK[meta.priority] : "",
    meta.due ? `📅 ${meta.due}` : "",
  ].filter(Boolean).join(" ");
  return `- ${meta.text}${extras ? ` · ${extras}` : ""} · ${link(meeting)}`;
}

export const byPriorityThenDue = (a: Item, b: Item) =>
  priorityRank(a.meta.priority) - priorityRank(b.meta.priority) ||
  (a.meta.due ?? "9999").localeCompare(b.meta.due ?? "9999");

export function list(items: Item[], sort: (a: Item, b: Item) => number = byPriorityThenDue): string[] {
  return items.length > 0 ? [...items].sort(sort).map(itemLine) : ["Nothing here."];
}

function grouped(items: Item[], key: (item: Item) => string | undefined, none: string): string[] {
  if (items.length === 0) return ["Nothing here."];
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const k = key(item)?.trim() || "";
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  return keys.flatMap((k) => [`### ${k || none} (${groups.get(k)!.length})`, "", ...list(groups.get(k)!), ""]).slice(0, -1);
}

/** The tracker note's content. `today` is YYYY-MM-DD; `updated` is shown as the time it was built. */
export function buildTracker(meetings: TrackerMeeting[], today: string, updated: string): string {
  const items: Item[] = meetings.flatMap((meeting) => meeting.openItems.map((meta) => ({ meta, meeting })));
  const weekAhead = addDays(today, 7);
  const overdue = items.filter((i) => i.meta.due && i.meta.due < today);
  const dueSoon = items.filter((i) => i.meta.due && i.meta.due >= today && i.meta.due <= weekAhead);
  const high = items.filter((i) => i.meta.priority === "high" || i.meta.priority === "highest");

  const day = new Date(`${today}T12:00:00`).getDay();
  const monday = addDays(today, -((day + 6) % 7));
  const sunday = addDays(monday, 6);
  const thisWeek = meetings
    .filter((m) => !m.skipped && m.date >= monday && m.date <= sunday)
    .sort((a, b) => a.date.localeCompare(b.date));
  const categories = new Map<string, TrackerMeeting[]>();
  for (const m of thisWeek) {
    const k = m.category?.trim() || "Uncategorized";
    categories.set(k, [...(categories.get(k) ?? []), m]);
  }

  const monthAgo = addDays(today, -30);
  const decided = meetings
    .filter((m) => m.decisions.length > 0 && m.date >= monthAgo && m.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));

  return [
    "# Meeting Tracker",
    "",
    `*Updated ${updated}. This note is rebuilt each time you run **Open meeting tracker** — edits here are overwritten.*`,
    "",
    "## At a glance",
    "",
    "| Open items | Overdue | Due in 7 days | High priority | Meetings this week |",
    "| ---: | ---: | ---: | ---: | ---: |",
    `| ${items.length} | ${overdue.length} | ${dueSoon.length} | ${high.length} | ${thisWeek.length} |`,
    "",
    "## Overdue",
    "",
    ...list(overdue, (a, b) => (a.meta.due ?? "").localeCompare(b.meta.due ?? "")),
    "",
    "## Due in the next 7 days",
    "",
    ...list(dueSoon, (a, b) => (a.meta.due ?? "").localeCompare(b.meta.due ?? "") || byPriorityThenDue(a, b)),
    "",
    "## High priority",
    "",
    ...list(high),
    "",
    "## Open items by account",
    "",
    ...grouped(items, (i) => i.meeting.account, "No account"),
    "",
    "## Open items by person",
    "",
    ...grouped(items, (i) => i.meta.owner, "Unassigned"),
    "",
    "## Decisions in the last 30 days",
    "",
    ...(decided.length > 0
      ? decided.flatMap((m) => [`### ${link(m)} · ${m.date}`, "", ...m.decisions.map((d) => `- ${d}`), ""]).slice(0, -1)
      : ["Nothing here."]),
    "",
    `## Meetings this week (${monday} to ${sunday})`,
    "",
    ...(thisWeek.length > 0
      ? [
        "| Category | Meetings |",
        "| --- | --- |",
        ...[...categories.keys()].sort().map((k) => `| ${k} (${categories.get(k)!.length}) | ${categories.get(k)!.map((m) => link(m, true)).join(", ")} |`),
      ]
      : ["Nothing here."]),
    "",
  ].join("\n");
}
