import { App, normalizePath, TFile } from "obsidian";
import { CalendarEvent } from "./calendarApi";

// ---------------------------------------------------------------------------
// HTML → plain text helpers
// ---------------------------------------------------------------------------

/**
 * Convert an HTML string (as returned by Google Calendar event descriptions)
 * to clean plain text, preserving line breaks and list items.
 */
function stripHtml(html: string): string {
  return (
    html
      // Block-level tags → newlines
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      // Preserve list item markers
      .replace(/<li[^>]*>/gi, "")
      // Strip remaining tags
      .replace(/<[^>]+>/g, "")
      // Decode common HTML entities
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      // Collapse multiple blank lines
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Parse the event description into an array of agenda bullet strings.
 * Each non-empty line in the description becomes one bullet item.
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
  // Returns YYYY-MM-DD
  return isoDateOrDateTime.slice(0, 10);
}

interface EventTiming {
  /** Human-readable date, e.g. "Monday, March 28, 2026" */
  dateLong: string;
  /** Human-readable time range, e.g. "10:00 AM – 11:00 AM" or "All day" */
  timeRange: string;
  /** ISO date for frontmatter, e.g. "2026-03-28" */
  dateIso: string;
  isAllDay: boolean;
}

function getEventTiming(event: CalendarEvent): EventTiming {
  if (event.start.date) {
    // All-day event — `start.date` is "YYYY-MM-DD"
    return {
      dateLong: formatDateLong(event.start.date + "T12:00:00"),
      timeRange: "All day",
      dateIso: event.start.date,
      isAllDay: true,
    };
  }

  const startDt = event.start.dateTime!;
  const endDt = event.end.dateTime!;
  return {
    dateLong: formatDateLong(startDt),
    timeRange: `${formatTime(startDt)} – ${formatTime(endDt)}`,
    dateIso: formatIsoDate(startDt),
    isAllDay: false,
  };
}

// ---------------------------------------------------------------------------
// Note content builder
// ---------------------------------------------------------------------------

/**
 * Build the full Markdown content for a meeting note.
 *
 * Structure:
 *   YAML frontmatter
 *   # Event Title
 *   metadata block (date, time, location, video link, attendees)
 *   ---
 *   ## Agenda    ← populated from the event description/invite notes
 *   ## Notes     ← empty bullet list for live notes
 *   ## Summary   ← empty bullet list for post-meeting summary
 *   ## Actions   ← empty bullet list for action items / follow-ups
 */
export function createNoteContent(event: CalendarEvent): string {
  const timing = getEventTiming(event);
  const title = event.summary?.trim() || "Untitled Event";

  // Attendees (exclude the calendar owner's own entry)
  const attendees = (event.attendees ?? [])
    .filter((a) => !a.self)
    .map((a) => a.displayName?.trim() || a.email);

  // Organizer (if different from attendees list or not already captured)
  const organizer = event.organizer?.displayName || event.organizer?.email;

  // Video / conference link
  const videoEntry = event.conferenceData?.entryPoints?.find(
    (ep) => ep.entryPointType === "video"
  );

  // Parse agenda from event description / invite notes
  const agendaItems = event.description
    ? parseAgendaItems(event.description)
    : [];

  // -------------------------------------------------------------------------
  // YAML Frontmatter
  // -------------------------------------------------------------------------
  const frontmatterLines = [
    "---",
    `title: "${title.replace(/"/g, '\\"')}"`,
    `date: ${timing.dateIso}`,
    `calendar_event_id: "${event.id}"`,
  ];

  if (event.location) {
    frontmatterLines.push(`location: "${event.location.replace(/"/g, '\\"')}"`);
  }
  if (attendees.length > 0) {
    frontmatterLines.push("attendees:");
    attendees.forEach((a) =>
      frontmatterLines.push(`  - "${a.replace(/"/g, '\\"')}"`)
    );
  }
  if (event.conferenceData?.conferenceSolution?.name) {
    frontmatterLines.push(
      `conference_platform: "${event.conferenceData.conferenceSolution.name}"`
    );
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
  ];

  if (event.location) {
    lines.push(`**Location:** ${event.location}`);
  }
  if (videoEntry) {
    const platform =
      event.conferenceData?.conferenceSolution?.name ?? "Video call";
    lines.push(`**${platform}:** [Join meeting](${videoEntry.uri})`);
  }
  if (organizer) {
    lines.push(`**Organizer:** ${organizer}`);
  }
  if (attendees.length > 0) {
    lines.push(`**Attendees:** ${attendees.join(", ")}`);
  }

  lines.push("", "---", "");

  // -------------------------------------------------------------------------
  // ## Agenda
  // Populated from the event description / invite notes if present;
  // otherwise an empty bullet for the user to fill in.
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
  // ## Notes
  // Live meeting notes — starts with a single empty bullet.
  // -------------------------------------------------------------------------
  lines.push("## Notes", "", "- ", "");

  // -------------------------------------------------------------------------
  // ## Summary
  // Post-meeting summary — starts with a single empty bullet.
  // -------------------------------------------------------------------------
  lines.push("## Summary", "", "- ", "");

  // -------------------------------------------------------------------------
  // ## Actions
  // Action items / follow-ups — starts with a single empty bullet.
  // -------------------------------------------------------------------------
  lines.push("## Actions", "", "- ", "");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// File system helpers
// ---------------------------------------------------------------------------

/**
 * Generate a filesystem-safe filename for the note.
 * Format: "YYYY-MM-DD Event Title"
 */
export function generateNoteFilename(event: CalendarEvent): string {
  const raw = event.summary?.trim() || "Untitled Event";
  // Replace characters forbidden in most file systems
  const safe = raw.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();

  const dateIso = event.start.dateTime
    ? formatIsoDate(event.start.dateTime)
    : event.start.date ?? new Date().toISOString().slice(0, 10);

  return `${dateIso} ${safe}`;
}

/**
 * Create the note file in the vault.
 * If a note with the same path already exists, open the existing file.
 */
export async function createNoteFile(
  app: App,
  event: CalendarEvent,
  folder: string
): Promise<TFile> {
  const content = createNoteContent(event);
  const filename = generateNoteFilename(event);

  const folderPath = normalizePath(folder);
  const filePath = normalizePath(
    folderPath ? `${folderPath}/${filename}.md` : `${filename}.md`
  );

  // Ensure folder exists
  if (folderPath && !app.vault.getAbstractFileByPath(folderPath)) {
    await app.vault.createFolder(folderPath);
  }

  // Return existing file rather than overwriting
  const existing = app.vault.getAbstractFileByPath(filePath);
  if (existing instanceof TFile) {
    return existing;
  }

  return app.vault.create(filePath, content);
}
