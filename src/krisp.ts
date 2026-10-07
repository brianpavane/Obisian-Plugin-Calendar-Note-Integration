/**
 * @file krisp.ts
 * @description Read Krisp recordings from disk and match them to meetings.
 *
 * Krisp saves each recording in its own folder, named "<title> - October 6,
 * 2026 2-30-24 PM", with a `transcript.txt` (or `.md`) that starts with a
 * short header followed by blank lines and the transcript:
 *
 *   Zoom meeting - October 6, 2026 2-30-24 PM
 *   October 6, 2026 2:30:24 PM
 *   30m 9s
 */

import { App, FuzzySuggestModal } from "obsidian";
import { promises as fs, Stats } from "fs";
import { homedir } from "os";
import { join } from "path";

const TRANSCRIPT_FILES = ["transcript.txt", "transcript.md"];
/** The " - October 6, 2026 2-30-24 PM" Krisp adds to titles and folder names. */
const STAMP_RE = /\s+-\s+([A-Za-z]+ \d{1,2}, \d{4}) (\d{1,2})-(\d{2})-(\d{2}) ([AP]M)\s*$/i;
const HEADER_BYTES = 2_048;
const MATCH_BEFORE_MS = 20 * 60_000;
const MATCH_AFTER_MS = 30 * 60_000;

export interface KrispHeader {
  title: string;
  start?: Date;
  /** Number of lines before the transcript itself. */
  headerLines: number;
}

export interface Recording {
  /** The recording's folder name. */
  name: string;
  path: string;
  title: string;
  /** Start time from the header, else the folder name, else when the transcript file was created. */
  time: Date;
}

export interface MeetingTime {
  title: string;
  start: Date;
  end: Date;
}

function stripLabel(line: string): string {
  return line.replace(/^[A-Za-z][A-Za-z ]{0,19}:\s+(?=\S)/, "").trim();
}

function parseDateLine(line: string): Date | undefined {
  const value = stripLabel(line).replace(/\s+at\s+/i, " ").replace(/(\d)\s*([ap]m)\b/i, "$1 $2");
  if (!/\d{1,2}:\d{2}/.test(value) || !/\d{4}/.test(value)) return undefined;
  const date = new Date(value);
  return isNaN(date.getTime()) ? undefined : date;
}

/** A title or folder name without Krisp's date stamp, and the time in that stamp. */
export function splitStamp(name: string): { title: string; time?: Date } {
  const m = name.match(STAMP_RE);
  if (!m) return { title: name.trim() };
  const time = new Date(`${m[1]} ${m[2]}:${m[3]}:${m[4]} ${m[5]}`);
  return { title: name.slice(0, m.index).trim(), time: isNaN(time.getTime()) ? undefined : time };
}

/** Title and start time from the top of a transcript; the header ends at the first blank line (at most 3 lines). */
export function parseKrispHeader(text: string): KrispHeader {
  const lines = text.split(/\r?\n/);
  let headerLines = 0;
  while (headerLines < 3 && headerLines < lines.length && lines[headerLines].trim()) headerLines++;
  const header = lines.slice(0, headerLines);
  const start = header.map(parseDateLine).find((d) => d !== undefined);
  const titleLine = header.find((l) => parseDateLine(l) === undefined);
  return { title: titleLine ? splitStamp(stripLabel(titleLine)).title : "", start, headerLines };
}

/** The transcript without its header, ready for a note: lines that would read as Markdown headings are escaped. */
export function transcriptBody(text: string): string[] {
  const { headerLines } = parseKrispHeader(text);
  const lines = text.split(/\r?\n/).slice(headerLines);
  while (lines.length > 0 && !lines[0].trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  return lines.map((l) => l.replace(/^(\s*)#/, "$1\\#"));
}

export function expandHome(path: string): string {
  return path.trim().replace(/^~(?=$|\/)/, homedir());
}

async function readHead(path: string): Promise<string> {
  const handle = await fs.open(path, "r");
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Recordings in the Krisp folder (one subfolder each), newest first; only those changed since `since` if given. */
export async function listRecordings(folder: string, since?: Date): Promise<Recording[]> {
  const root = expandHome(folder);
  const recordings: Recording[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let found: { path: string; stat: Stats } | undefined;
    for (const file of TRANSCRIPT_FILES) {
      const path = join(root, entry.name, file);
      const stat = await fs.stat(path).catch(() => undefined);
      if (stat?.isFile()) {
        found = { path, stat };
        break;
      }
    }
    if (!found || (since && found.stat.mtime < since)) continue;
    const header = parseKrispHeader(await readHead(found.path));
    const folder = splitStamp(entry.name);
    recordings.push({
      name: entry.name,
      path: found.path,
      title: header.title || folder.title,
      time: header.start ?? folder.time ?? found.stat.birthtime,
    });
  }
  return recordings.sort((a, b) => b.time.getTime() - a.time.getTime());
}

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The recording of a meeting: one made from 20 minutes before it starts to 30
 * minutes after it ends, preferring a matching title, then the closest start.
 */
export function matchRecording(recordings: Recording[], meeting: MeetingTime): Recording | undefined {
  const from = meeting.start.getTime() - MATCH_BEFORE_MS;
  const to = meeting.end.getTime() + MATCH_AFTER_MS;
  const title = normalize(meeting.title);
  const titleMatches = (r: Recording) => {
    const other = normalize(r.title);
    return !!title && !!other && (other.includes(title) || title.includes(other));
  };
  const distance = (r: Recording) => Math.abs(r.time.getTime() - meeting.start.getTime());
  return recordings
    .filter((r) => r.time.getTime() >= from && r.time.getTime() <= to)
    .sort((a, b) => Number(titleMatches(b)) - Number(titleMatches(a)) || distance(a) - distance(b))[0];
}

export async function readTranscript(recording: Recording): Promise<string[]> {
  return transcriptBody(await fs.readFile(recording.path, "utf8"));
}

/** Pick a recording by hand when none matches the meeting. */
export class RecordingSuggestModal extends FuzzySuggestModal<Recording> {
  constructor(app: App, private readonly recordings: Recording[], private readonly onChoose: (r: Recording) => void) {
    super(app);
    this.setPlaceholder("No recording matches this meeting's time — choose one");
  }

  getItems(): Recording[] {
    return this.recordings;
  }

  getItemText(recording: Recording): string {
    const when = recording.time.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    return `${recording.title} — ${when}`;
  }

  onChooseItem(recording: Recording): void {
    this.onChoose(recording);
  }
}
