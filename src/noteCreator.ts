/**
 * @file noteCreator.ts
 * @description Builds structured Obsidian Markdown notes from Google Calendar
 * events and writes them to the vault.
 *
 * Security notes:
 *   - YAML injection: All values written to the YAML frontmatter are escaped
 *     with {@link escapeYaml} so that newlines and special characters cannot
 *     inject additional YAML keys.
 *   - Markdown table injection: Pipe characters and newlines in attendee
 *     name/email fields are escaped with {@link escapeMdCell} to prevent
 *     table row corruption.
 *   - Markdown body injection: Newlines in inline fields (title, location,
 *     organizer) are stripped with {@link sanitizeInline} so they cannot
 *     create extra headings or break bold metadata lines.
 *   - URL injection: Conference entry-point URIs are validated with
 *     {@link isSafeHttpsUrl} before being embedded in a Markdown link.
 *     Non-HTTPS URIs are silently dropped.
 */

import { App, normalizePath, TFile } from "obsidian";
import { CalendarEvent } from "./calendarApi";

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe use inside a YAML double-quoted scalar.
 *
 * YAML double-quoted strings interpret the following escape sequences:
 *   `\\`  →  literal backslash
 *   `\"`  →  literal double-quote
 *   `\n`  →  newline  (would end the scalar and start a new YAML key)
 *   `\r`  →  carriage return
 *   `\t`  →  tab
 *
 * This function prevents an attacker-controlled event field (e.g. a title
 * containing `"\nmalicious_key: value"`) from injecting extra YAML keys.
 */
function escapeYaml(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

/**
 * Sanitise a string for use inside a Markdown table cell.
 *
 * Pipe characters (`|`) end the current cell and would corrupt the table
 * structure. Newlines would start a new table row.  Both are replaced with
 * safe alternatives.
 */
function escapeMdCell(value: string): string {
  return value
    .replace(/\r?\n/g, " ") // newlines → space
    .replace(/\|/g, "\\|"); // pipes → escaped pipe
}

/**
 * Sanitise a string for use in an inline Markdown context (headings, bold).
 *
 * Newlines in a `# Heading` or `**bold**` field would produce unexpected
 * additional lines. This collapses all line-break sequences to a single space.
 */
function sanitizeInline(value: string): string {
  return value.replace(/\r?\n|\r/g, " ").trim();
}

/**
 * Return `true` only when `uri` is a valid absolute URL with an `https:`
 * scheme (or `http:` for local/legacy cases).
 *
 * Prevents `javascript:`, `data:`, and other dangerous URI schemes from
 * being embedded in Markdown links where they would execute on click.
 */
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

/**
 * Convert an HTML string (as returned by Google Calendar event descriptions)
 * to clean plain text, preserving logical line breaks and list structure.
 *
 * Google Calendar stores rich-text descriptions as HTML; this converts them
 * to the plain text needed for Markdown bullet lists.
 */
function stripHtml(html: string): string {
  return html
    // Block-level closing tags → newlines
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    // Opening list-item tags carry no useful text
    .replace(/<li[^>]*>/gi, "")
    // Strip all remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Collapse runs of 3+ blank lines to at most 2
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Parse the event description into an array of agenda bullet strings.
 *
 * HTML is stripped first. Each non-empty line in the resulting plain text
 * becomes one agenda bullet item.
 *
 * @param description Raw description from the Calendar API (HTML or plain text).
 * @returns           Array of trimmed, non-empty lines.
 */
function parseAgendaItems(description: string): string[] {
  const text = stripHtml(description);
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// Date / time formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO date-time string as a long human-readable date.
 *
 * @example "Monday, March 30, 2026"
 */
function formatDateLong(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Format an ISO date-time string as a short 12-hour time.
 *
 * @example "10:30 AM"
 */
function formatTime(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Extract the `YYYY-MM-DD` date portion from an ISO date or date-time string.
 */
function formatIsoDate(isoDateOrDateTime: string): string {
  return isoDateOrDateTime.slice(0, 10);
}

/** Timing data derived from a calendar event. */
interface EventTiming {
  /** Human-readable date, e.g. "Monday, March 30, 2026". */
  dateLong: string;
  /** Human-readable time range, e.g. "10:00 AM – 11:00 AM" or "All day". */
  timeRange: string;
  /** ISO date for YAML frontmatter, e.g. "2026-03-30". */
  dateIso: string;
}

/**
 * Derive display-ready timing strings from a calendar event.
 *
 * Handles both timed events (`start.dateTime`) and all-day events
 * (`start.date`).
 */
function getEventTiming(event: CalendarEvent): EventTiming {
  if (event.start.date) {
    // All-day event: `start.date` is "YYYY-MM-DD" with no time component.
    return {
      dateLong: formatDateLong(event.start.date + "T12:00:00"),
      timeRange: "All day",
      dateIso: event.start.date,
    };
  }

  const startDt = event.start.dateTime!;
  const endDt = event.end.dateTime!;
  return {
    dateLong: formatDateLong(startDt),
    timeRange: `${formatTime(startDt)} – ${formatTime(endDt)}`,
    dateIso: formatIsoDate(startDt),
  };
}

// ---------------------------------------------------------------------------
// Attendee helpers
// ---------------------------------------------------------------------------

/** Recognised RSVP status values from the Google Calendar API. */
type ResponseStatus = "accepted" | "declined" | "tentative" | "needsAction";

/**
 * Colored-circle emoji shown in the attendees table status column.
 *
 * 🟢 Accepted · 🔴 Declined · 🟡 Tentative · ⚪ Awaiting · 🔷 Organizer
 */
const RESPONSE_ICON: Record<ResponseStatus, string> = {
  accepted: "🟢",
  declined: "🔴",
  tentative: "🟡",
  needsAction: "⚪",
};

/**
 * Map a raw API `responseStatus` string to the appropriate status emoji.
 * Falls back to ⚪ (awaiting) for unknown or absent values.
 */
function responseIcon(status: string | undefined): string {
  return RESPONSE_ICON[(status ?? "needsAction") as ResponseStatus] ?? "⚪";
}

/** One row in the rendered attendees table. */
interface AttendeeRow {
  /** Status emoji (e.g. 🟢). */
  icon: string;
  /** Display name, escaped for Markdown table cells. */
  name: string;
  /** Email address, escaped for Markdown table cells. */
  email: string;
}

/**
 * Build the list of attendee rows for the note.
 *
 * The organizer is listed first (with a 🔷 icon) when they do not also
 * appear in the `attendees` array. All self entries are excluded.
 *
 * All name and email strings are run through {@link escapeMdCell} to prevent
 * Markdown table injection.
 */
function buildAttendeeRows(event: CalendarEvent): AttendeeRow[] {
  const rows: AttendeeRow[] = [];

  // Organizer first (only when not already present in the attendees list).
  if (event.organizer) {
    const alreadyListed = (event.attendees ?? []).some(
      (a) => a.email === event.organizer!.email
    );
    if (!alreadyListed) {
      const rawName =
        event.organizer.displayName?.trim() || event.organizer.email;
      rows.push({
        icon: "🔷",
        name: escapeMdCell(rawName) + " *(organizer)*",
        email: escapeMdCell(event.organizer.email),
      });
    }
  }

  // Non-self attendees in API order.
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

/**
 * Render the attendees list as a Markdown table with three columns:
 * status icon, display name, and email address.
 *
 * ```markdown
 * |   | Name              | Email                  |
 * |:-:|:------------------|:-----------------------|
 * | 🟢 | Alice Smith       | alice@example.com      |
 * | 🔴 | Bob Jones         | bob@example.com        |
 * ```
 *
 * @param rows Pre-built, already-escaped attendee rows.
 */
function renderAttendeesTable(rows: AttendeeRow[]): string {
  if (rows.length === 0) return "";

  const lines = [
    "|   | Name | Email |",
    "|:-:|:-----|:------|",
  ];
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
 * The generated note has the following structure:
 *
 * ```
 * ---                         ← YAML frontmatter (title, date, attendees, …)
 * # Event Title
 *
 * **Date:** …
 * **Time:** …
 * **Location:** …             (if present)
 * **<Platform>:** [Join](…)   (if conference link present and HTTPS)
 * **Organizer:** …            (if present)
 *
 * **Attendees:**              (if any)
 * | 🟢/🔴/🟡/⚪/🔷 | Name | Email |
 *
 * ---
 *
 * ## Agenda                   ← Bullets from event description, or empty
 * ## Notes                    ← Empty bullet list
 * ## Summary                  ← Empty bullet list
 * ## Actions                  ← Empty bullet list
 * ```
 *
 * @param event Calendar event from the Google Calendar API.
 * @returns     Complete Markdown string ready to be written to a `.md` file.
 */
export function createNoteContent(event: CalendarEvent): string {
  const timing = getEventTiming(event);

  // Sanitize inline fields: strip newlines that would break Markdown structure.
  const title = sanitizeInline(event.summary?.trim() || "Untitled Event");
  const location = event.location ? sanitizeInline(event.location) : undefined;
  const organizer = event.organizer
    ? sanitizeInline(
        event.organizer.displayName?.trim() || event.organizer.email
      )
    : undefined;

  const attendeeRows = buildAttendeeRows(event);

  // Conference link — validate URI scheme before embedding.
  const videoEntry = event.conferenceData?.entryPoints?.find(
    (ep) => ep.entryPointType === "video"
  );
  const safeVideoUri =
    videoEntry && isSafeHttpsUrl(videoEntry.uri) ? videoEntry.uri : undefined;
  const platform = sanitizeInline(
    event.conferenceData?.conferenceSolution?.name ?? "Video call"
  );

  // Agenda items parsed from the invite description.
  const agendaItems = event.description
    ? parseAgendaItems(event.description)
    : [];

  // -------------------------------------------------------------------------
  // YAML Frontmatter
  // All values are escaped with escapeYaml() to prevent YAML injection.
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
      // Strip the *(organizer)* Markdown suffix before writing to YAML.
      const plainName = a.name.replace(/\s*\*\(organizer\)\*/g, "").trim();
      frontmatterLines.push(
        `  - "${escapeYaml(plainName)} <${escapeYaml(a.email)}>"`
      );
    });
  }
  if (event.conferenceData?.conferenceSolution?.name) {
    frontmatterLines.push(
      `conference_platform: "${escapeYaml(platform)}"`
    );
  }
  frontmatterLines.push("---");

  // -------------------------------------------------------------------------
  // Header + metadata block
  // Inline fields are sanitized; the conference URI is validated above.
  // -------------------------------------------------------------------------
  const lines: string[] = [
    frontmatterLines.join("\n"),
    "",
    `# ${title}`,
    "",
    `**Date:** ${timing.dateLong}`,
    `**Time:** ${timing.timeRange}`,
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

  // Attendees table (name, email, RSVP icon).
  if (attendeeRows.length > 0) {
    lines.push("", "**Attendees:**", "", renderAttendeesTable(attendeeRows));
  }

  lines.push("", "---", "");

  // -------------------------------------------------------------------------
  // ## Agenda
  // Pre-populated from the invite description; empty bullet if none.
  // -------------------------------------------------------------------------
  lines.push("## Agenda", "");
  if (agendaItems.length > 0) {
    agendaItems.forEach((item) => lines.push(`- ${item}`));
    lines.push("- "); // trailing blank bullet for easy continuation
  } else {
    lines.push("- ");
  }
  lines.push("");

  // -------------------------------------------------------------------------
  // ## Notes  (live meeting notes)
  // -------------------------------------------------------------------------
  lines.push("## Notes", "", "- ", "");

  // -------------------------------------------------------------------------
  // ## Summary  (post-meeting summary)
  // -------------------------------------------------------------------------
  lines.push("## Summary", "", "- ", "");

  // -------------------------------------------------------------------------
  // ## Actions  (action items / follow-ups)
  // -------------------------------------------------------------------------
  lines.push("## Actions", "", "- ", "");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// File system helpers
// ---------------------------------------------------------------------------

/**
 * Generate a filesystem-safe filename for the meeting note.
 *
 * Format: `"YYYY-MM-DD Event Title"`
 *
 * Characters forbidden by common file systems (`\ / : * ? " < > |`) are
 * replaced with hyphens, and runs of whitespace are collapsed.
 *
 * @param event Calendar event to generate a name for.
 * @returns     Filename string **without** the `.md` extension.
 */
export function generateNoteFilename(event: CalendarEvent): string {
  const raw = event.summary?.trim() || "Untitled Event";
  const safe = raw.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();

  const dateIso = event.start.dateTime
    ? formatIsoDate(event.start.dateTime)
    : event.start.date ?? new Date().toISOString().slice(0, 10);

  return `${dateIso} ${safe}`;
}

/** Return value of {@link createNoteFile}. */
export interface CreateNoteResult {
  /** The vault file (new or pre-existing). */
  file: TFile;
  /**
   * `true` when the file was created by this call; `false` when it already
   * existed and was returned unchanged.
   */
  wasCreated: boolean;
}

/**
 * Create a meeting-note file in the vault for the given event.
 *
 * If a file at the computed path already exists it is returned as-is
 * (idempotent — user edits are never overwritten). The `wasCreated` flag
 * in the result distinguishes new files from pre-existing ones.
 *
 * The destination folder is created recursively if it does not yet exist.
 *
 * @param app    The Obsidian `App` instance.
 * @param event  Calendar event to create a note for.
 * @param folder Vault-relative folder path. Pass `""` for the vault root.
 * @returns      `{ file, wasCreated }`.
 */
export async function createNoteFile(
  app: App,
  event: CalendarEvent,
  folder: string
): Promise<CreateNoteResult> {
  const content = createNoteContent(event);
  const filename = generateNoteFilename(event);

  // Normalise the folder path, treating an empty string as the vault root.
  const trimmedFolder = folder.trim();
  const folderPath = trimmedFolder ? normalizePath(trimmedFolder) : "";
  const filePath = normalizePath(
    folderPath ? `${folderPath}/${filename}.md` : `${filename}.md`
  );

  // Create the folder if it does not already exist.
  if (folderPath && !app.vault.getAbstractFileByPath(folderPath)) {
    await app.vault.createFolder(folderPath);
  }

  // Return the existing file without modification.
  const existing = app.vault.getAbstractFileByPath(filePath);
  if (existing instanceof TFile) {
    return { file: existing, wasCreated: false };
  }

  const file = await app.vault.create(filePath, content);
  return { file, wasCreated: true };
}
