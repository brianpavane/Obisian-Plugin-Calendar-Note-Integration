/**
 * @file series.ts
 * @description Series notes: one per recurring meeting, in the Meeting Hub's
 * Series folder. The user's own sections (Purpose, Standing agenda) are left
 * alone; the plugin's part — every occurrence, open items across the series
 * and recent decisions — is rebuilt between two markers each time it opens.
 */

import { link, list, type Item, type TrackerMeeting } from "./tracker";
import { replaceBetweenMarkers } from "./weeklyReview";

export const SERIES_FOLDER = "Series";
export const SERIES_START =
  "<!-- meeting-series:start — the plugin rebuilds everything down to the end marker each time you open this note. Write above it. -->";
export const SERIES_END = "<!-- meeting-series:end -->";

const RECENT_DECISIONS = 5;

/** The plugin's part of a series note, from the occurrences' notes. */
export function seriesBody(occurrences: TrackerMeeting[], updated: string): string {
  const newestFirst = [...occurrences].sort((a, b) => b.date.localeCompare(a.date));
  const held = newestFirst.filter((m) => !m.skipped);
  const open: Item[] = newestFirst.flatMap((meeting) => meeting.openItems.map((meta) => ({ meta, meeting })));
  const decided = held.filter((m) => m.decisions.length > 0).slice(0, RECENT_DECISIONS);

  const occurrence = (m: TrackerMeeting) => {
    const openCount = m.openItems.length > 0 ? ` · ${m.openItems.length} open` : "";
    return m.skipped
      ? `- ~~${m.date || "No date"} · ${link(m)}~~ · ${m.status ?? "didn't happen"}`
      : `- ${m.date || "No date"} · ${link(m)}${openCount}`;
  };

  return [
    SERIES_START,
    `*Updated ${updated}. Items and decisions come from each meeting's own note — change them there, then reopen this note.*`,
    "",
    "| Meetings held | Open items | Decisions |",
    "| --- | --- | --- |",
    `| ${held.length} | ${open.length} | ${held.reduce((n, m) => n + m.decisions.length, 0)} |`,
    "",
    "## Meetings",
    "",
    ...(newestFirst.length > 0 ? newestFirst.map(occurrence) : ["No meeting notes yet."]),
    "",
    "## Open items",
    "",
    ...list(open),
    "",
    "## Recent decisions",
    "",
    ...(decided.length > 0
      ? decided.flatMap((m) => [`### ${link(m)} · ${m.date}`, "", ...m.decisions.map((d) => `- ${d}`), ""]).slice(0, -1)
      : ["Nothing here."]),
    "",
    SERIES_END,
  ].join("\n");
}

/** A new series note: properties, title, the user's sections, then the plugin's part. */
export function newSeriesNote(title: string, seriesId: string, body: string): string {
  const quoted = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return [
    "---",
    "type: meeting-series",
    `title: ${quoted(title)}`,
    `series_id: ${quoted(seriesId)}`,
    "tags:",
    "  - meeting-series",
    "---",
    "",
    `# ${title}`,
    "",
    "## Purpose",
    "",
    "- ",
    "",
    "## Standing agenda",
    "",
    "- ",
    "",
    body,
    "",
  ].join("\n");
}

/** Replace the plugin's part of an existing series note, keeping everything else. */
export function refreshSeries(content: string, body: string): string {
  return replaceBetweenMarkers(content, body, SERIES_START, SERIES_END);
}
