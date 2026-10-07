/**
 * @file noteCreator.ts
 * @description Builds structured Obsidian Markdown notes from calendar events
 * and writes them to the vault.
 *
 * Security notes:
 *   - YAML injection: All values written to frontmatter are escaped with
 *     {@link escapeYaml} so that newlines and special characters cannot inject
 *     additional YAML keys.
 *   - Markdown body injection: Inline fields are flattened and their Markdown
 *     syntax escaped with {@link escapeInlineMd}; link targets are stripped of
 *     wikilink syntax with {@link linkTarget}.
 *   - URL injection: Conference entry-point URIs are validated with
 *     {@link isSafeHttpsUrl} before being embedded in a Markdown link.
 */

import { App, moment, normalizePath, TFile } from "obsidian";
import { CalendarEvent, ResponseStatus } from "./calendarApi";

// ---------------------------------------------------------------------------
// Public options interface
// ---------------------------------------------------------------------------

/** Options that control the content and filename format of generated notes. */
export interface NoteOptions {
  /** Vault-relative folder path. Empty = vault root. */
  noteFolder: string;
  /** When true, include the event's original description in a collapsed callout. */
  includeEventNotes: boolean;
  /** When true, attendees and organizer are written as `[[Name]]` links. */
  linkAttendees: boolean;
  /** Daily-note naming used to link each meeting to its day. Undefined = no link. */
  dailyNote?: DailyNoteConfig;
  /** Contents of the user's template note. Undefined = built-in template. */
  template?: string;
  /** Vault path (without `.md`) of the previous meeting in the same series. */
  previousNote?: string;
  /** Open action items of the previous meeting, listed in the new note's Agenda. */
  carriedItems?: string[];
  /**
   * "before" → "2026-03-30 - Meeting Title.md"
   * "after"  → "Meeting Title - 2026-03-30.md"
   */
  datePosition: "before" | "after";
}

/** Where daily notes live and how they are named (a moment.js format). */
export interface DailyNoteConfig {
  format: string;
  folder: string;
}

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

function escapeYaml(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

function sanitizeInline(value: string): string {
  return value.replace(/\r?\n|\r/g, " ").trim();
}

function isSafeHttpsUrl(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// HTML → plain text helpers
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  // Cap input before DOM parsing to prevent DoS on pathologically large descriptions.
  const safe = html.length > 10_000 ? html.slice(0, 10_000) : html;
  try {
    const doc = new DOMParser().parseFromString(safe, "text/html");

    function walk(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent ?? "";
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
      }
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      const blockTags = new Set([
        "p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6",
        "tr", "blockquote", "pre",
      ]);
      const prefix = blockTags.has(tag) ? "\n" : "";
      let inner = "";
      for (const child of Array.from(el.childNodes)) {
        inner += walk(child);
      }
      return prefix + inner;
    }

    return walk(doc.body)
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch {
    return html.replace(/<[^>]+>/g, " ").trim();
  }
}

/**
 * Remove Zoom / Google Meet / Teams invite boilerplate from plain text so
 * it does not appear in the Agenda section of the generated note.
 * The conference link itself is already extracted and placed in the note
 * header when "Include conference link" is enabled.
 */
function stripConferenceBoilerplate(text: string): string {
  // Google Calendar wraps the entire conference block between delimiter lines
  // that start with "-::~:~::".  Remove everything from the first such line
  // to the last (inclusive), handling both LF and CRLF line endings.
  const gcalDelimRe = /^-::~:~::/m;
  if (gcalDelimRe.test(text)) {
    // Find the first and last occurrence of the delimiter line and strip the
    // entire span between them (the block always has an opening and closing
    // delimiter line, but guard against a lone delimiter by trimming the rest).
    const lines = text.split(/\r?\n/);
    const firstIdx = lines.findIndex((l) => /^-::~:~::/.test(l));
    const lastIdx  = lines.reduceRight(
      (found, l, i) => (found === -1 && /^-::~:~::/.test(l) ? i : found),
      -1
    );
    if (firstIdx !== -1) {
      text = [
        ...lines.slice(0, firstIdx),
        ...lines.slice(lastIdx + 1),
      ].join("\n");
    }
  }

  // Lines containing a known conference URL are always removed.
  const conferenceUrlRe =
    /https?:\/\/(?:[\w.-]+\.zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com)\//i;

  // Common Zoom / Teams / Meet invite boilerplate line prefixes.
  const boilerplatePrefixes = [
    /^join\s+(?:zoom\s+)?meeting\b/i,
    /^meeting\s+id\s*:/i,
    /^passcode\s*:/i,
    /^password\s*:/i,
    /^dial\s+by\s+your\s+location\b/i,
    /^dial\s+in\s+by\s+phone\b/i,
    /^one\s+tap\s+mobile\b/i,
    /^find\s+your\s+local\s+number\b/i,
    /^join\s+by\s+sip\b/i,
    /^join\s+by\s+h\.?323\b/i,
    /^join\s+by\s+skype\b/i,
    /^\+\d[\d\s,*#]{6,}$/,  // dial-in phone numbers
    /^\d{6,}(?:\s*#)+$/,    // numeric conference codes
  ];

  const cleaned = text.split("\n").filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (conferenceUrlRe.test(t)) return false;
    if (boilerplatePrefixes.some((re) => re.test(t))) return false;
    return true;
  });
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function descriptionLines(description: string): string[] {
  const lines = stripConferenceBoilerplate(stripHtml(description))
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""));
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}

// ---------------------------------------------------------------------------
// Date / time helpers
// ---------------------------------------------------------------------------

interface LocalParts {
  date: string;
  time: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Calendar date and wall-clock time of an ISO timestamp. A timestamp with an
 * explicit UTC offset keeps the event's own local date and time; a UTC ("Z")
 * timestamp is converted to this machine's time zone.
 */
function localParts(iso: string): LocalParts {
  const dateOnly = iso.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnly) return { date: dateOnly[1], time: "00:00" };

  const withOffset = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?[+-]\d{2}:?\d{2}$/);
  if (withOffset) return { date: withOffset[1], time: withOffset[2] };

  const d = new Date(iso);
  const valid = isNaN(d.getTime()) ? new Date() : d;
  return {
    date: `${valid.getFullYear()}-${pad2(valid.getMonth() + 1)}-${pad2(valid.getDate())}`,
    time: `${pad2(valid.getHours())}:${pad2(valid.getMinutes())}`,
  };
}

/**
 * Short time zone label for an ISO timestamp: this machine's zone name (e.g.
 * "EST") when the timestamp is UTC or matches this machine's offset, otherwise
 * the timestamp's own offset as "GMT-5" / "GMT+5:30".
 */
function zoneLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const offset = iso.match(/([+-])(\d{2}):?(\d{2})$/);
  if (offset) {
    const minutes = (offset[1] === "-" ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3]));
    if (minutes !== -d.getTimezoneOffset()) {
      const h = Math.floor(Math.abs(minutes) / 60);
      const m = Math.abs(minutes) % 60;
      return minutes === 0 ? "GMT" : `GMT${offset[1]}${h}${m ? `:${pad2(m)}` : ""}`;
    }
  }
  return new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName")?.value ?? "";
}

function formatDateLong(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime12h(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${pad2(h % 12 === 0 ? 12 : h % 12)}:${pad2(m)} ${suffix}`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

interface EventTiming {
  allDay: boolean;
  date: string;
  start?: string;
  end?: string;
  dateLong: string;
  startTime: string;
  endTime: string;
  timeRange: string;
  duration: string;
}

function getEventTiming(event: CalendarEvent): EventTiming {
  if (!event.start.dateTime) {
    const date = event.start.date ?? localParts(new Date().toISOString()).date;
    return {
      allDay: true,
      date,
      dateLong: formatDateLong(date),
      startTime: "",
      endTime: "",
      timeRange: "All day",
      duration: "All day",
    };
  }

  const startDt = event.start.dateTime;
  const endDt = event.end.dateTime ?? startDt;
  const s = localParts(startDt);
  const e = localParts(endDt);
  const startZone = zoneLabel(startDt);
  const endZone = zoneLabel(endDt);
  const withZone = (time: string, zone: string) => (zone ? `${time} ${zone}` : time);
  const startTime = withZone(formatTime12h(s.time), startZone);
  const endTime = withZone(formatTime12h(e.time), endZone);
  return {
    allDay: false,
    date: s.date,
    start: `${s.date}T${s.time}`,
    end: `${e.date}T${e.time}`,
    dateLong: formatDateLong(s.date),
    startTime,
    endTime,
    timeRange: startZone === endZone
      ? `${formatTime12h(s.time)} – ${endTime}`
      : `${startTime} – ${endTime}`,
    duration: formatDuration(new Date(endDt).getTime() - new Date(startDt).getTime()),
  };
}

// ---------------------------------------------------------------------------
// Attendee helpers
// ---------------------------------------------------------------------------

const RESPONSE_ICON: Record<ResponseStatus, string> = {
  accepted: "🟢",
  declined: "🔴",
  tentative: "🟡",
  needsAction: "⚪",
};

function responseIcon(status: string | undefined): string {
  return RESPONSE_ICON[(status ?? "needsAction") as ResponseStatus] ?? "⚪";
}

function escapeInlineMd(value: string): string {
  return sanitizeInline(value).replace(/([\\`*_[\]<>|#])/g, "\\$1");
}

function linkTarget(name: string): string {
  return sanitizeInline(name).replace(/[[\]|#^\\]/g, "").trim();
}

interface Person {
  name: string;
  email: string;
  hasName: boolean;
  icon: string;
  organizer: boolean;
}

function buildPeople(event: CalendarEvent): Person[] {
  const people: Person[] = [];
  if (event.organizer && !(event.attendees ?? []).some((a) => a.email === event.organizer!.email)) {
    const name = event.organizer.displayName?.trim();
    people.push({
      name: name || event.organizer.email,
      email: event.organizer.email,
      hasName: !!name,
      icon: "🔷",
      organizer: true,
    });
  }
  for (const a of event.attendees ?? []) {
    if (a.self) continue;
    const name = a.displayName?.trim();
    people.push({
      name: name || a.email,
      email: a.email,
      hasName: !!name,
      icon: responseIcon(a.responseStatus),
      organizer: !!a.organizer || a.email === event.organizer?.email,
    });
  }
  return people;
}

function personProperty(p: Person, linkAttendees: boolean): string {
  if (linkAttendees && p.hasName && linkTarget(p.name)) return `[[${linkTarget(p.name)}]]`;
  return p.hasName && p.email !== p.name ? `${sanitizeInline(p.name)} <${sanitizeInline(p.email)}>` : sanitizeInline(p.email);
}

function personInline(p: Person, linkAttendees: boolean): string {
  const label = linkAttendees && p.hasName && linkTarget(p.name)
    ? `[[${linkTarget(p.name)}]]`
    : escapeInlineMd(p.name);
  return p.organizer ? `${label} *(organizer)*` : label;
}

// ---------------------------------------------------------------------------
// Note content
// ---------------------------------------------------------------------------

interface MeetingLink {
  url: string;
  platform: string;
}

function meetingLink(event: CalendarEvent): MeetingLink | undefined {
  const entry = event.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === "video");
  if (!entry || !isSafeHttpsUrl(entry.uri)) return undefined;
  return {
    url: new URL(entry.uri).href.replace(/\(/g, "%28").replace(/\)/g, "%29"),
    platform: sanitizeInline(event.conferenceData?.conferenceSolution?.name ?? "") || "Video call",
  };
}

function organizerName(event: CalendarEvent): string | undefined {
  if (!event.organizer) return undefined;
  return sanitizeInline(event.organizer.displayName?.trim() || event.organizer.email) || undefined;
}

/** Frontmatter keys the plugin keeps in sync with the calendar. `null` = remove. */
type SyncOptions = Pick<NoteOptions, "linkAttendees" | "dailyNote" | "previousNote">;

interface DailyLink {
  target: string;
  name: string;
}

function dailyNoteLink(date: string, config: DailyNoteConfig | undefined): DailyLink | undefined {
  if (!config) return undefined;
  const formatted = moment(date, "YYYY-MM-DD").format(config.format || "YYYY-MM-DD");
  const folder = config.folder.trim() ? normalizePath(config.folder.trim()) + "/" : "";
  return { target: `${folder}${formatted}`, name: formatted.split("/").pop() ?? formatted };
}

function wikilink(link: DailyLink, alias = link.name): string {
  return link.target === alias ? `[[${link.target}]]` : `[[${link.target}|${alias}]]`;
}

function previousLink(path: string | undefined): DailyLink | undefined {
  return path ? { target: path, name: path.split("/").pop() ?? path } : undefined;
}

function managedFrontmatter(
  event: CalendarEvent,
  options: SyncOptions
): Array<[string, string[] | null]> {
  const timing = getEventTiming(event);
  const people = buildPeople(event).filter((p) => !p.organizer || (event.attendees ?? []).some((a) => a.email === p.email));
  const organizer = organizerName(event);
  const organizerPerson = buildPeople(event).find((p) => p.organizer);
  const link = meetingLink(event);
  const quoted = (key: string, value: string | undefined): [string, string[] | null] =>
    [key, value ? [`${key}: "${escapeYaml(value)}"`] : null];

  return [
    quoted("title", sanitizeInline(event.summary?.trim() || "Untitled Event")),
    ["date", [`date: ${timing.date}`]],
    quoted("daily_note", (() => {
      const link = dailyNoteLink(timing.date, options.dailyNote);
      return link ? wikilink(link) : undefined;
    })()),
    quoted("previous_meeting", (() => {
      const link = previousLink(options.previousNote);
      return link ? wikilink(link) : undefined;
    })()),
    ["start", timing.start ? [`start: ${timing.start}`] : null],
    ["end", timing.end ? [`end: ${timing.end}`] : null],
    quoted("calendar", event.calendarName ? sanitizeInline(event.calendarName) : undefined),
    quoted("organizer", organizerPerson ? personProperty(organizerPerson, options.linkAttendees) : organizer),
    ["attendees", people.length > 0
      ? ["attendees:", ...people.map((p) => `  - "${escapeYaml(personProperty(p, options.linkAttendees))}"`)]
      : null],
    quoted("location", event.location ? sanitizeInline(event.location) : undefined),
    quoted("meeting_url", link?.url),
    quoted("conference_platform", link ? link.platform : undefined),
    ["status", event.cancelled ? ["status: cancelled"] : null],
    quoted("calendar_event_id", event.id),
  ];
}

const DETAILS_CALLOUT_RE = /^> \[!(info|danger)\] Meeting (details|cancelled|removed from calendar)\s*$/;

function renderDetailsCallout(event: CalendarEvent, options: SyncOptions): string[] {
  const timing = getEventTiming(event);
  const link = meetingLink(event);
  const lines = [event.cancelled ? "> [!danger] Meeting cancelled" : "> [!info] Meeting details"];

  const daily = dailyNoteLink(timing.date, options.dailyNote);
  const day = daily ? wikilink(daily, timing.dateLong) : timing.dateLong;
  lines.push(
    timing.allDay
      ? `> **When:** ${day} · All day`
      : `> **When:** ${day} · ${timing.timeRange} (${timing.duration})`
  );
  const previous = previousLink(options.previousNote);
  if (previous) lines.push(`> **Previous:** ${wikilink(previous)}`);
  if (event.location) lines.push(`> **Where:** ${escapeInlineMd(event.location)}`);
  if (link) lines.push(`> **Join:** [Join ${escapeInlineMd(link.platform)}](${link.url})`);

  const organizer = organizerName(event);
  if (organizer) lines.push(`> **Organizer:** ${escapeInlineMd(organizer)}`);

  const people = buildPeople(event);
  if (people.length > 0) {
    lines.push(`> **Attendees:** ${people.map((p) => `${p.icon} ${personInline(p, options.linkAttendees)}`).join(" · ")}`);
  }
  return lines;
}

/** The sections of the built-in note layout that can be switched off. */
export interface NoteSections {
  agenda: boolean;
  notes: boolean;
  decisions: boolean;
  actionItems: boolean;
  summary: boolean;
  transcript: boolean;
}

export const ALL_SECTIONS: NoteSections = {
  agenda: true,
  notes: true,
  decisions: true,
  actionItems: true,
  summary: true,
  transcript: true,
};

const SECTION_BLOCKS: Array<[keyof NoteSections, string]> = [
  ["agenda", "## Agenda\n\n{{agenda}}\n"],
  ["notes", "## Notes\n\n- \n"],
  ["decisions", "## Decisions\n\n- \n"],
  ["actionItems", "## Action items\n\n- [ ] \n"],
  ["summary", "## Meeting Summary\n\n\n"],
  ["transcript", "## Transcript\n\n"],
];

/** The built-in note layout with the chosen sections, written in the same placeholder syntax as user templates. */
export function builtInTemplate(sections: NoteSections = ALL_SECTIONS): string {
  const blocks = SECTION_BLOCKS.filter(([key]) => sections[key]).map(([, block]) => `\n${block}`);
  return `---\ntype: meeting\ntags:\n  - meeting\n---\n\n# {{title}}\n\n{{details}}\n${blocks.join("")}`;
}

export const DEFAULT_TEMPLATE = builtInTemplate();

/** Placeholders available in templates, mapped to their value for this event. */
function templateValues(
  event: CalendarEvent,
  options: Pick<NoteOptions, "includeEventNotes" | "linkAttendees" | "dailyNote" | "previousNote" | "carriedItems">
): Record<string, string> {
  const timing = getEventTiming(event);
  const link = meetingLink(event);
  const people = buildPeople(event);
  const organizer = buildPeople(event).find((p) => p.organizer);
  const daily = dailyNoteLink(timing.date, options.dailyNote);
  const description = options.includeEventNotes && event.description
    ? descriptionLines(event.description)
    : [];
  const previous = previousLink(options.previousNote);
  const carried = previous && options.carriedItems?.length
    ? [`- Open items from ${wikilink(previous, "last meeting")}:`, ...options.carriedItems.map((item) => `  - ${item}`)]
    : [];

  return {
    title: sanitizeInline(event.summary?.trim() || "Untitled Event"),
    date: timing.date,
    date_long: timing.dateLong,
    start: timing.start ?? "",
    end: timing.end ?? "",
    start_time: timing.startTime,
    end_time: timing.endTime,
    time: timing.timeRange,
    duration: timing.duration,
    location: event.location ? escapeInlineMd(event.location) : "",
    calendar: event.calendarName ? escapeInlineMd(event.calendarName) : "",
    organizer: organizer
      ? personInline({ ...organizer, organizer: false }, options.linkAttendees)
      : escapeInlineMd(organizerName(event) ?? ""),
    attendees: people.map((p) => personInline({ ...p, organizer: false }, options.linkAttendees)).join(", "),
    attendee_list: people.map((p) => `- ${p.icon} ${personInline(p, options.linkAttendees)}`).join("\n"),
    meeting_url: link?.url ?? "",
    platform: link ? escapeInlineMd(link.platform) : "",
    join_link: link ? `[Join ${escapeInlineMd(link.platform)}](${link.url})` : "",
    description: description.join("\n"),
    agenda: [...description.filter((l) => l.trim()).map((l) => `- ${l.trim()}`), ...carried, "- "].join("\n"),
    description_callout: description.length > 0
      ? ["> [!quote]- Event description", ...description.map((l) => (l.trim() ? `> ${l}` : ">"))].join("\n")
      : "",
    details: renderDetailsCallout(event, options).join("\n"),
    daily_note: daily ? wikilink(daily) : "",
    previous_meeting: previous ? wikilink(previous) : "",
    event_id: escapeInlineMd(event.id),
  };
}

const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/**
 * Fill a template's placeholders. A line holding only placeholders that come
 * out empty is dropped, together with a blank line that would then double up.
 * Unknown placeholders (and other syntax such as Templater's) are left as-is.
 */
function fillPlaceholders(text: string, values: Record<string, string>): string {
  const out: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const filled = line.replace(PLACEHOLDER_RE, (m, key: string) => (key in values ? values[key] : m));
    const onlyPlaceholders = line.trim() !== "" && line.replace(PLACEHOLDER_RE, "").trim() === "";
    if (onlyPlaceholders && filled.trim() === "") {
      if (out.length > 0 && out[out.length - 1].trim() === "" && lines[i + 1]?.trim() === "") i++;
      continue;
    }
    out.push(filled);
  }
  return out.join("\n");
}

type FrontmatterBlock = { key: string | null; lines: string[] };

function parseFrontmatter(content: string): { blocks: FrontmatterBlock[]; end: string; rest: string } | null {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/) ?? content.match(/^---\r?\n()---(\r?\n|$)/);
  if (!fm) return null;
  const blocks: FrontmatterBlock[] = [];
  for (const line of fm[1] ? fm[1].split(/\r?\n/) : []) {
    const key = line.match(/^([A-Za-z0-9_-]+):/)?.[1] ?? null;
    if (key || blocks.length === 0) blocks.push({ key, lines: [line] });
    else blocks[blocks.length - 1].lines.push(line);
  }
  return { blocks, end: fm[2], rest: content.slice(fm[0].length) };
}

/**
 * Write the managed keys into a frontmatter block list: existing keys are
 * replaced in place, keys set to null are removed, and new keys go before
 * `tags` (or at the end).
 */
function applyManagedFrontmatter(blocks: FrontmatterBlock[], entries: Array<[string, string[] | null]>): void {
  for (const [key, lines] of entries) {
    const index = blocks.findIndex((b) => b.key === key);
    if (lines === null) {
      if (index !== -1) blocks.splice(index, 1);
    } else if (index !== -1) {
      blocks[index] = { key, lines };
    } else {
      const tags = blocks.findIndex((b) => b.key === "tags");
      blocks.splice(tags === -1 ? blocks.length : tags, 0, { key, lines });
    }
  }
}

/**
 * Build the full Markdown content for a new meeting note from the user's
 * template (or the built-in one). The plugin's calendar properties are always
 * added to the frontmatter so the note can be kept in sync.
 */
export function createNoteContent(
  event: CalendarEvent,
  options: Pick<NoteOptions, "includeEventNotes" | "linkAttendees" | "dailyNote" | "template" | "previousNote" | "carriedItems">
): string {
  const template = (options.template ?? DEFAULT_TEMPLATE).replace(/\r\n/g, "\n");
  const values = templateValues(event, options);
  const managed = managedFrontmatter(event, options);

  const parsed = parseFrontmatter(template);
  if (!parsed) {
    const lines = managed.flatMap(([, l]) => l ?? []);
    return `---\n${lines.join("\n")}\n---\n\n${fillPlaceholders(template, values)}`;
  }

  const yamlValues: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    yamlValues[key] = value.includes("\n") ? "" : escapeYaml(value);
  }
  const blocks = parsed.blocks.map((b) => ({
    key: b.key,
    lines: b.lines.map((l) => l.replace(PLACEHOLDER_RE, (m, key: string) => (key in yamlValues ? yamlValues[key] : m))),
  }));
  applyManagedFrontmatter(blocks, managed);

  return `---\n${blocks.flatMap((b) => b.lines).join("\n")}\n---\n${fillPlaceholders(parsed.rest, values)}`;
}

/**
 * Bring an existing note's calendar details up to date with the event.
 *
 * Only the managed frontmatter keys and the "Meeting details" callout are
 * rewritten; everything else in the note is returned unchanged. Notes without
 * a frontmatter block are returned as-is.
 */
export function updateNoteContent(
  content: string,
  event: CalendarEvent,
  options: SyncOptions
): string {
  const parsed = parseFrontmatter(content);
  if (!parsed) return content;

  applyManagedFrontmatter(parsed.blocks, managedFrontmatter(event, options));

  const newFrontmatter = `---\n${parsed.blocks.flatMap((b) => b.lines).join("\n")}\n---${parsed.end}`;
  const bodyLines = parsed.rest.split("\n");

  const start = bodyLines.findIndex((line) => DETAILS_CALLOUT_RE.test(line.replace(/\r$/, "")));
  if (start !== -1) {
    let end = start + 1;
    while (end < bodyLines.length && bodyLines[end].startsWith(">")) end++;
    bodyLines.splice(start, end - start, ...renderDetailsCallout(event, options));
  }

  return newFrontmatter + bodyLines.join("\n");
}

/** Set one quoted string property in a note's frontmatter; a note without frontmatter is returned unchanged. */
export function setFrontmatterValue(content: string, key: string, value: string): string {
  const parsed = parseFrontmatter(content);
  if (!parsed) return content;
  applyManagedFrontmatter(parsed.blocks, [[key, [`${key}: "${escapeYaml(sanitizeInline(value))}"`]]]);
  return `---\n${parsed.blocks.flatMap((b) => b.lines).join("\n")}\n---${parsed.end}${parsed.rest}`;
}

/** HTTPS join URL for the event's video meeting, if it has one. */
export function joinUrl(event: CalendarEvent): string | undefined {
  return meetingLink(event)?.url;
}

/**
 * Mark a note whose meeting is no longer in the calendar: `status: removed`
 * and a "Meeting removed from calendar" box. The next sync that sees the
 * meeting again restores both. Returns true if the note changed.
 */
export async function markNoteRemoved(app: App, file: TFile): Promise<boolean> {
  const mark = (content: string): string => {
    const parsed = parseFrontmatter(content);
    if (!parsed) return content;
    applyManagedFrontmatter(parsed.blocks, [["status", ["status: removed"]]]);
    const body = parsed.rest
      .split("\n")
      .map((line) => (DETAILS_CALLOUT_RE.test(line.replace(/\r$/, "")) ? "> [!danger] Meeting removed from calendar" : line))
      .join("\n");
    return `---\n${parsed.blocks.flatMap((b) => b.lines).join("\n")}\n---${parsed.end}${body}`;
  };

  const current = await app.vault.read(file);
  if (mark(current) === current) return false;
  await app.vault.process(file, mark);
  return true;
}

/** Calendar date (YYYY-MM-DD) used for the event's filename and `date` property. */
export function eventDate(event: CalendarEvent): string {
  return getEventTiming(event).date;
}

// ---------------------------------------------------------------------------
// File system helpers
// ---------------------------------------------------------------------------

/**
 * Generate a filesystem-safe filename for the meeting note.
 *
 * "before": `YYYY-MM-DD - Event Title`
 * "after":  `Event Title - YYYY-MM-DD`
 *
 * Characters forbidden by common file systems are replaced with hyphens.
 *
 * @param event        Calendar event.
 * @param datePosition Whether the date comes before or after the title.
 * @returns            Filename string without the `.md` extension.
 */
export function generateNoteFilename(
  event: CalendarEvent,
  datePosition: "before" | "after" = "before"
): string {
  const raw = event.summary?.trim() || "Untitled Event";
  const safe = raw
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "") || "Untitled Event";

  const dateIso = eventDate(event);

  return datePosition === "after" ? `${safe} - ${dateIso}` : `${dateIso} - ${safe}`;
}

/** Return value of {@link createNoteFile}. */
export interface CreateNoteResult {
  file: TFile;
  wasCreated: boolean;
}

/**
 * Compute the vault file path that {@link createNoteFile} would use for a given event,
 * without creating or modifying any files. Useful for existence checks before calling
 * {@link createNoteFile}.
 */
export function resolveNoteFilePath(
  event: CalendarEvent,
  options: Pick<NoteOptions, "noteFolder" | "datePosition">
): string {
  const filename = generateNoteFilename(event, options.datePosition);
  const trimmedFolder = options.noteFolder.trim();
  const folderPath = trimmedFolder ? normalizePath(trimmedFolder) : "";
  return normalizePath(folderPath ? `${folderPath}/${filename}.md` : `${filename}.md`);
}

/**
 * Create a meeting-note file in the vault for the given event.
 *
 * Idempotent — if the file already exists it is returned unchanged.
 * The destination folder is created recursively if needed.
 *
 * @param app     The Obsidian `App` instance.
 * @param event   Calendar event to create a note for.
 * @param options Note content and location options.
 */
export async function createNoteFile(
  app: App,
  event: CalendarEvent,
  options: NoteOptions
): Promise<CreateNoteResult> {
  const content = createNoteContent(event, options);
  const filename = generateNoteFilename(event, options.datePosition);

  const trimmedFolder = options.noteFolder.trim();
  const folderPath = trimmedFolder ? normalizePath(trimmedFolder) : "";
  const filePath = normalizePath(
    folderPath ? `${folderPath}/${filename}.md` : `${filename}.md`
  );

  if (folderPath && !app.vault.getAbstractFileByPath(folderPath)) {
    await app.vault.createFolder(folderPath);
  }

  const existing = app.vault.getAbstractFileByPath(filePath);
  if (existing instanceof TFile) {
    return { file: existing, wasCreated: false };
  }

  const file = await app.vault.create(filePath, content);
  return { file, wasCreated: true };
}

/**
 * Index every note in the vault by its `calendar_event_id` property, so notes
 * filed away from the note folder are still found.
 */
export function findNotesByEventId(app: App): Map<string, TFile> {
  const byId = new Map<string, TFile>();
  for (const file of app.vault.getMarkdownFiles()) {
    const id = app.metadataCache.getFileCache(file)?.frontmatter?.calendar_event_id;
    if (typeof id === "string" && id && !byId.has(id)) byId.set(id, file);
  }
  return byId;
}

/**
 * Update an existing note's calendar details from the event, and rename it if
 * the meeting moved to another day (only the date part of the filename changes,
 * so a title the user edited is kept). Returns true if anything changed.
 */
export async function syncNoteFile(
  app: App,
  file: TFile,
  event: CalendarEvent,
  options: SyncOptions
): Promise<boolean> {
  let changed = false;
  const current = await app.vault.read(file);
  const oldDate = current.match(/^date:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1];
  if (updateNoteContent(current, event, options) !== current) {
    await app.vault.process(file, (content) => updateNoteContent(content, event, options));
    changed = true;
  }

  const newDate = eventDate(event);
  const slash = file.path.lastIndexOf("/");
  const dir = slash === -1 ? "" : file.path.slice(0, slash + 1);
  const basename = file.path.slice(slash + 1).replace(/\.md$/, "");
  if (oldDate && oldDate !== newDate && basename.includes(oldDate)) {
    const newPath = `${dir}${basename.replace(oldDate, newDate)}.md`;
    if (!app.vault.getAbstractFileByPath(newPath)) {
      await app.fileManager.renameFile(file, newPath);
      changed = true;
    }
  }
  return changed;
}

/**
 * The note of the previous occurrence of a recurring meeting. Occurrence IDs
 * are `<series uid>::<original start, ISO UTC>`, so the previous one is the
 * note in the same series with the latest earlier start.
 */
export function previousNoteInSeries(notesById: Map<string, TFile>, eventId: string): TFile | undefined {
  const sep = eventId.lastIndexOf("::");
  if (sep === -1) return undefined;
  const series = eventId.slice(0, sep + 2);
  const occurrence = eventId.slice(sep + 2);
  let best: { occurrence: string; file: TFile } | undefined;
  for (const [id, file] of notesById) {
    if (!id.startsWith(series) || id.indexOf("::", series.length) !== -1) continue;
    const other = id.slice(series.length);
    if (other < occurrence && (!best || other > best.occurrence)) best = { occurrence: other, file };
  }
  return best?.file;
}

/** An unchecked task in a note, with its 0-based line number. */
export interface OpenTask {
  line: number;
  text: string;
}

const OPEN_TASK_RE = /^\s*[-*+] \[ \] (.*\S)\s*$/;

/** Unchecked, non-empty tasks (`- [ ] …`) in a note's content. */
export function openTasks(content: string): OpenTask[] {
  const tasks: OpenTask[] = [];
  content.split("\n").forEach((line, i) => {
    const m = line.replace(/\r$/, "").match(OPEN_TASK_RE);
    if (m) tasks.push({ line: i, text: m[1] });
  });
  return tasks;
}

/**
 * Note options for one event: the link to the previous meeting in its series
 * and, when `withItems` is set (new notes), that meeting's open action items.
 */
export async function seriesOptions(
  app: App,
  notesById: Map<string, TFile>,
  event: CalendarEvent,
  withItems: boolean
): Promise<Pick<NoteOptions, "previousNote" | "carriedItems">> {
  const previous = previousNoteInSeries(notesById, event.id);
  if (!previous) return {};
  return {
    previousNote: previous.path.replace(/\.md$/, ""),
    carriedItems: withItems ? openTasks(await app.vault.read(previous)).map((t) => t.text) : undefined,
  };
}
