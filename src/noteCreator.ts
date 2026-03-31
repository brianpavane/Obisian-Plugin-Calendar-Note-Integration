/**
 * @file noteCreator.ts
 * @description Builds structured Obsidian Markdown notes from calendar events
 * and writes them to the vault.
 *
 * Security notes:
 *   - YAML injection: All values written to frontmatter are escaped with
 *     {@link escapeYaml} so that newlines and special characters cannot inject
 *     additional YAML keys.
 *   - Markdown table injection: Pipe characters and newlines in attendee
 *     name/email fields are escaped with {@link escapeMdCell}.
 *   - Markdown body injection: Newlines in inline fields are stripped with
 *     {@link sanitizeInline}.
 *   - URL injection: Conference entry-point URIs are validated with
 *     {@link isSafeHttpsUrl} before being embedded in a Markdown link.
 */

import { App, normalizePath, TFile } from "obsidian";
import { CalendarEvent, ResponseStatus } from "./calendarApi";

// ---------------------------------------------------------------------------
// Public options interface
// ---------------------------------------------------------------------------

/** Options that control the content and filename format of generated notes. */
export interface NoteOptions {
  /** Vault-relative folder path. Empty = vault root. */
  noteFolder: string;
  /**
   * When true, include the event's description as the Agenda section.
   * When false, the Agenda section is omitted.
   */
  includeEventNotes: boolean;
  /**
   * When true, include conference links (Zoom, Teams, Google Meet) in the note.
   * When false, conference links are omitted from the note body and frontmatter.
   */
  includeConferenceLinks: boolean;
  /**
   * "before" → "2026-03-30 - Meeting Title.md"
   * "after"  → "Meeting Title - 2026-03-30.md"
   */
  datePosition: "before" | "after";
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

function escapeMdCell(value: string): string {
  return value
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|");
}

function sanitizeInline(value: string): string {
  return value.replace(/\r?\n|\r/g, " ").trim();
}

function isSafeHttpsUrl(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === "https:" || url.protocol === "http:";
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

function parseAgendaItems(description: string): string[] {
  const text = stripConferenceBoilerplate(stripHtml(description));
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// Date / time formatting helpers
// ---------------------------------------------------------------------------

function formatDateLong(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatIsoDate(isoDateOrDateTime: string): string {
  const d = new Date(isoDateOrDateTime);
  if (isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
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
  dateLong: string;
  timeRange: string;
  dateIso: string;
  duration: string;
}

function getEventTiming(event: CalendarEvent): EventTiming {
  if (event.start.date) {
    return {
      dateLong: formatDateLong(event.start.date + "T12:00:00"),
      timeRange: "All day",
      dateIso: event.start.date,
      duration: "All day",
    };
  }

  const startDt = event.start.dateTime ?? new Date().toISOString();
  const endDt = event.end.dateTime ?? startDt;
  const durationMs = new Date(endDt).getTime() - new Date(startDt).getTime();
  return {
    dateLong: formatDateLong(startDt),
    timeRange: `${formatTime(startDt)} – ${formatTime(endDt)}`,
    dateIso: formatIsoDate(startDt),
    duration: formatDuration(durationMs),
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

interface AttendeeRow {
  icon: string;
  name: string;
  email: string;
}

function buildAttendeeRows(event: CalendarEvent): AttendeeRow[] {
  const rows: AttendeeRow[] = [];

  if (event.organizer) {
    const alreadyListed = (event.attendees ?? []).some(
      (a) => a.email === event.organizer!.email
    );
    if (!alreadyListed) {
      const rawName = event.organizer.displayName?.trim() || event.organizer.email;
      rows.push({
        icon: "🔷",
        name: escapeMdCell(rawName) + " *(organizer)*",
        email: escapeMdCell(event.organizer.email),
      });
    }
  }

  for (const a of event.attendees ?? []) {
    if (a.self) continue;
    const icon = responseIcon(a.responseStatus);
    const rawName = a.displayName?.trim() || a.email;
    const nameSuffix = a.organizer ? " *(organizer)*" : "";
    rows.push({
      icon,
      name: escapeMdCell(rawName) + nameSuffix,
      email: escapeMdCell(a.email),
    });
  }

  return rows;
}

function renderAttendeesTable(rows: AttendeeRow[]): string {
  if (rows.length === 0) return "";
  const lines = ["|   | Name | Email |", "|:-:|:-----|:------|"];
  for (const row of rows) {
    lines.push(`| ${row.icon} | ${row.name} | ${row.email} |`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Note content builder
// ---------------------------------------------------------------------------

/**
 * Build the full Markdown content for a meeting note.
 *
 * @param event   Calendar event.
 * @param options Controls which sections are included.
 */
export function createNoteContent(
  event: CalendarEvent,
  options: Pick<NoteOptions, "includeEventNotes" | "includeConferenceLinks">
): string {
  const timing = getEventTiming(event);
  const title = sanitizeInline(event.summary?.trim() || "Untitled Event");
  const location = event.location ? sanitizeInline(event.location) : undefined;
  const organizer = event.organizer
    ? sanitizeInline(event.organizer.displayName?.trim() || event.organizer.email)
    : undefined;

  const attendeeRows = buildAttendeeRows(event);

  // Conference link — only included when option is enabled and URI is safe.
  const videoEntry =
    options.includeConferenceLinks
      ? event.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === "video")
      : undefined;
  const safeVideoUri =
    videoEntry && isSafeHttpsUrl(videoEntry.uri) ? videoEntry.uri : undefined;
  const platform = sanitizeInline(
    event.conferenceData?.conferenceSolution?.name ?? "Video call"
  );

  const agendaItems = event.description ? parseAgendaItems(event.description) : [];

  // -------------------------------------------------------------------------
  // YAML Frontmatter
  // -------------------------------------------------------------------------
  const frontmatterLines: string[] = [
    "---",
    `title: "${escapeYaml(title)}"`,
    `date: ${timing.dateIso}`,
    `calendar_event_id: "${escapeYaml(event.id)}"`,
  ];

  if (location) {
    frontmatterLines.push(`location: "${escapeYaml(location)}"`);
  }
  if (attendeeRows.length > 0) {
    frontmatterLines.push("attendees:");
    attendeeRows.forEach((a) => {
      const plainName = a.name.replace(/\s*\*\(organizer\)\*/g, "").trim();
      frontmatterLines.push(`  - "${escapeYaml(plainName)} <${escapeYaml(a.email)}>"`);
    });
  }
  if (!event.start.date) {
    frontmatterLines.push(`duration: "${escapeYaml(timing.duration)}"`);
  }
  if (options.includeConferenceLinks && event.conferenceData?.conferenceSolution?.name) {
    frontmatterLines.push(`conference_platform: "${escapeYaml(platform)}"`);
  }
  frontmatterLines.push("---");

  // -------------------------------------------------------------------------
  // Header + metadata block
  // -------------------------------------------------------------------------
  const lines: string[] = [
    frontmatterLines.join("\n"),
    "",
    `# ${title}`,
    "",
    `**Date:** ${timing.dateLong}`,
    `**Time:** ${timing.timeRange}`,
    ...(event.start.date ? [] : [`**Duration:** ${timing.duration}`]),
  ];

  if (location) {
    lines.push(`**Location:** ${location}`);
  }
  if (safeVideoUri) {
    lines.push(`**${platform}:** [Join meeting](${safeVideoUri})`);
  }
  if (organizer) {
    lines.push(`**Organizer:** ${organizer}`);
  }

  if (attendeeRows.length > 0) {
    lines.push("", "**Attendees:**", "", renderAttendeesTable(attendeeRows));
  }

  lines.push("", "---", "");

  // -------------------------------------------------------------------------
  // ## Agenda  (optional — controlled by includeEventNotes)
  // -------------------------------------------------------------------------
  if (options.includeEventNotes) {
    lines.push("## Agenda", "");
    if (agendaItems.length > 0) {
      agendaItems.forEach((item) => lines.push(`- ${item}`));
      lines.push("- ");
    } else {
      lines.push("- ");
    }
    lines.push("");
  }

  // -------------------------------------------------------------------------
  // ## Notes / Summary / Actions
  // -------------------------------------------------------------------------
  lines.push("## Notes", "", "- ", "");
  lines.push("## Summary", "", "- ", "");
  lines.push("## Actions", "", "- ", "");

  return lines.join("\n");
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

  const dateIso = event.start.dateTime
    ? formatIsoDate(event.start.dateTime)
    : event.start.date ?? new Date().toISOString().slice(0, 10);

  return datePosition === "after" ? `${safe} - ${dateIso}` : `${dateIso} - ${safe}`;
}

/** Return value of {@link createNoteFile}. */
export interface CreateNoteResult {
  file: TFile;
  wasCreated: boolean;
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
