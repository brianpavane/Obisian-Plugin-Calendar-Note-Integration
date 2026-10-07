/**
 * @file assistant.ts
 * @description The copy/paste round trip with an AI assistant (Gemini,
 * Claude, ChatGPT, Copilot…): copy a meeting's details, notes and transcript,
 * and file the assistant's reply into the note. The plugin never contacts
 * any AI service itself.
 *
 * Two reply shapes are understood:
 *   - the short format the built-in instructions ask for: `Summary`,
 *     `Decisions` and `Action items` headings;
 *   - a full report from a custom agent (see docs/AGENT_INSTRUCTIONS.md):
 *     the whole reply becomes the Meeting Summary, decisions come from a
 *     "Key Decisions Made" list and action items from an action items table.
 */

import { addFrontmatterTags, setFrontmatterValue } from "./noteCreator";
import { appendToSection, replaceSection, sectionLines, sectionText } from "./sections";

export const SUMMARY_SECTIONS = ["Meeting Summary", "Summary"];
export const DECISIONS_SECTIONS = ["Decisions"];
export const ACTION_SECTIONS = ["Action items"];
export const NOTES_SECTIONS = ["Notes"];
export const TRANSCRIPT_SECTIONS = ["Transcript"];

export const DEFAULT_INSTRUCTIONS = [
  "Write up the meeting below from my notes and the transcript. MEETING DETAILS comes from my calendar and is correct; MY NOTES are my own notes and take priority over the transcript.",
  "Reply in Markdown with exactly these three headings, in this order, and nothing before or after them:",
  "",
  "## Summary",
  "A short paragraph (3–6 sentences): what was discussed and what was concluded.",
  "",
  "## Decisions",
  "- One bullet per decision made in the meeting. Write \"- None\" if there were none.",
  "",
  "## Action items",
  "- [ ] One checkbox per follow-up task, starting with a verb.",
  "",
  "For each action item, add the owner as @[[Full Name]] (for example @[[Bob Jones]]) when it's clear who owns it,",
  "and a due date as 📅 YYYY-MM-DD when one was mentioned; turn relative dates such as \"by Friday\" into dates using the meeting date.",
  "Use only what's in the notes and transcript; don't invent tasks, owners or dates.",
].join("\n");

export interface MeetingInfo {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** e.g. "10:00 AM – 10:30 AM" */
  time: string;
  attendees: string[];
}

/**
 * What to paste into the assistant: optional instructions, then the meeting's
 * details, notes and transcript. Undefined if the note has neither notes nor
 * a transcript.
 */
export function copyText(content: string, meeting: MeetingInfo, instructions?: string): string | undefined {
  const notes = sectionText(content, NOTES_SECTIONS);
  const transcript = sectionText(content, TRANSCRIPT_SECTIONS);
  if (!notes && !transcript) return undefined;
  const block = [
    "MEETING DETAILS",
    `Title: ${meeting.title}`,
    ...(meeting.date ? [`Date: ${meeting.date}`] : []),
    ...(meeting.time ? [`Time: ${meeting.time}`] : []),
    ...(meeting.attendees.length > 0 ? [`Attendees: ${meeting.attendees.join(", ")}`] : []),
    "",
    "MY NOTES",
    notes || "(none)",
    "",
    "TRANSCRIPT",
    transcript || "(none)",
  ].join("\n");
  return instructions?.trim() ? `${instructions.trim()}\n\n${block}` : block;
}

export interface ActionItem {
  task: string;
  /** A person, written as `@[[Name]]`. */
  person?: string;
  /** A role or team that owns the task, written as `(owner: …)`. */
  role?: string;
  priority?: "High" | "Medium" | "Low";
  /** YYYY-MM-DD */
  due?: string;
  /** Text already in the assistant's own task format (short replies). */
  raw?: string;
}

export interface AssistantReply {
  summary: string[];
  decisions: string[];
  actionItems: ActionItem[];
  category?: string;
  account?: string;
  tags: string[];
}

const HEADING_RE = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/;
const LABEL_RE = /^\s*(?:[-*]\s+)?\*\*(.+?)\*\*\s*:?\s*$/;
const PLAIN_HEADING_RE = /^\s*(summary|decisions|action items)\s*:?\s*$/i;
const BULLET_RE = /^\s*(?:[-*+•]|\d+[.)])\s+(?:\[[ xX]?\]\s*)?/;
const RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FIELD_RE = /^\s*(?:[-*]\s+)?\*\*([^*]+?)\s*:?\s*\*\*\s*:?\s*(.*)$/;

/** The text of a heading or a bold label line ("**Key Decisions Made:**"), without numbering or colon. */
function headingText(line: string): { level: number; text: string } | undefined {
  const heading = line.match(HEADING_RE);
  const label = heading ? undefined : line.match(LABEL_RE) ?? line.match(PLAIN_HEADING_RE);
  const raw = heading?.[2] ?? label?.[1];
  if (raw === undefined) return undefined;
  const text = raw.replace(/\*\*/g, "").replace(/^\d+[.)]\s*/, "").replace(/:\s*$/, "").trim();
  return { level: heading ? heading[1].length : 7, text };
}

function trimBlank(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && !out[0].trim()) out.shift();
  while (out.length > 0 && !out[out.length - 1].trim()) out.pop();
  return out;
}

const isNone = (s: string) => /^(none|none noted|n\/a|-+)\.?$/i.test(s.trim());

/** Bullets following the line at `from`, up to the next heading, label or other text. */
function bulletsAfter(lines: string[], from: number): string[] {
  const out: string[] = [];
  for (let i = from + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (headingText(line) || !BULLET_RE.test(line)) break;
    const text = line.replace(BULLET_RE, "").trim();
    if (text && !isNone(text)) out.push(text);
  }
  return out;
}

function cells(row: string): string[] {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.replace(/\*\*/g, "").trim());
}

const ROLE_WORDS = /\b(team|group|customer|client|vendor|partner|it|ops|engineering|lead|leads|manager|management|leadership|sales|support|security|legal|finance|procurement|all|everyone|both|us|we|me|you|i|tbd|owner|unassigned|inferred)\b/i;
const PERSON_RE = /^[\p{Lu}][\p{L}'’.-]*(?:\s+[\p{Lu}][\p{L}'’.-]*){0,3}$/u;

function owner(cell: string): Pick<ActionItem, "person" | "role"> {
  const value = cell.replace(/^\[|\]$/g, "").replace(/^@/, "").trim();
  if (!value || isNone(value) || /^(unassigned|tbd)\b/i.test(value)) return {};
  if (/^(you|me|i|myself)$/i.test(value)) return { role: "me" };
  return PERSON_RE.test(value) && !ROLE_WORDS.test(value) ? { person: value } : { role: value };
}

function priority(cell: string): ActionItem["priority"] {
  if (/^h/i.test(cell)) return "High";
  if (/^m/i.test(cell)) return "Medium";
  if (/^l/i.test(cell)) return "Low";
  return undefined;
}

/** Rows of the first Markdown table after `from`, before the next heading. */
function tableAfter(lines: string[], from: number): ActionItem[] | undefined {
  let i = from + 1;
  while (i < lines.length && !lines[i].trim().startsWith("|")) {
    if (headingText(lines[i]) && headingText(lines[i])!.level <= 6) return undefined;
    if (BULLET_RE.test(lines[i])) return undefined;
    i++;
  }
  if (i >= lines.length) return undefined;
  const header = cells(lines[i]).map((h) => h.toLowerCase());
  const col = (re: RegExp, fallback: number) => {
    const found = header.findIndex((h) => re.test(h));
    return found === -1 ? fallback : found;
  };
  const taskCol = col(/action|task|item|description/, 0);
  const ownerCol = col(/owner|assignee|who/, -1);
  const priorityCol = col(/priority/, -1);
  const dueCol = col(/due|date|timeline|when/, -1);
  const items: ActionItem[] = [];
  for (i++; i < lines.length && lines[i].trim().startsWith("|"); i++) {
    const row = cells(lines[i]);
    if (row.every((c) => /^:?-+:?$/.test(c) || !c)) continue;
    const task = row[taskCol] ?? "";
    if (!task || isNone(task)) continue;
    items.push({
      task,
      ...(ownerCol >= 0 ? owner(row[ownerCol] ?? "") : {}),
      priority: priorityCol >= 0 ? priority(row[priorityCol] ?? "") : undefined,
      due: dueCol >= 0 ? (row[dueCol] ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0] : undefined,
    });
  }
  return items;
}

/** The full report as it goes under the Meeting Summary heading: headings demoted below it, no horizontal rules. */
function reportBody(lines: string[]): string[] {
  const levels = lines.map((l) => l.match(HEADING_RE)?.[1].length).filter((n): n is number => n !== undefined);
  const shift = levels.length > 0 ? Math.max(0, 3 - Math.min(...levels)) : 0;
  const out = lines.map((l) => {
    if (RULE_RE.test(l)) return "";
    const m = l.match(HEADING_RE);
    return m && shift ? `${"#".repeat(Math.min(6, m[1].length + shift))} ${m[2]}` : l.replace(/\s+$/, "");
  });
  return trimBlank(out).filter((l, i, all) => l.trim() || all[i - 1]?.trim());
}

/**
 * The reply itself, without chat around it: the inside of its code block if
 * the assistant used one, otherwise everything from the first heading or
 * label on (an opening "Sure! Here's…" line is dropped).
 */
function replyLines(text: string): string[] {
  const all = text.replace(/\r\n/g, "\n").split("\n");
  const fences = all.map((l, i) => (/^\s*```/.test(l) ? i : -1)).filter((i) => i !== -1);
  if (fences.length >= 2) return trimBlank(all.slice(fences[0] + 1, fences[fences.length - 1]));
  const lines = all.filter((l) => !/^\s*```/.test(l));
  const first = lines.findIndex((l) => !!headingText(l) || FIELD_RE.test(l));
  return trimBlank(first > 0 ? lines.slice(first) : lines);
}

/** The parts of an assistant's reply, or undefined if it has neither a summary nor action items to file. */
export function parseReply(text: string): AssistantReply | undefined {
  const lines = replyLines(text);
  const headings = lines.map(headingText);
  const find = (test: (t: string) => boolean) => headings.findIndex((h) => !!h && test(h.text.toLowerCase()));

  const summaryAt = find((t) => t === "summary");
  const decisionsAt = find((t) => t.includes("decision"));
  const actionsAt = find((t) => t.includes("action item"));

  let summary: string[];
  if (summaryAt !== -1) {
    const end = headings.findIndex((h, i) => i > summaryAt && !!h);
    summary = trimBlank(lines.slice(summaryAt + 1, end === -1 ? undefined : end))
      .map((l) => l.replace(/^\s*#{1,6}\s+(.*)$/, "**$1**"));
  } else {
    summary = decisionsAt !== -1 || actionsAt !== -1 ? reportBody(lines) : [];
  }

  let actionItems: ActionItem[] = [];
  if (actionsAt !== -1) {
    actionItems = tableAfter(lines, actionsAt) ?? bulletsAfter(lines, actionsAt).map((raw) => ({ task: raw, raw }));
  }

  if (summary.length === 0 && actionItems.length === 0 && decisionsAt === -1) return undefined;

  const field = (re: RegExp) => {
    for (const line of lines) {
      const m = line.match(FIELD_RE);
      if (m && re.test(m[1])) return m[2].trim();
    }
    return undefined;
  };
  const category = field(/^category$/i);
  const account = field(/^(primary )?account( \/ project)?$|^project$/i);
  const tags = [...(field(/^(search )?tags$/i) ?? "").matchAll(/#([\p{L}\p{N}_/-]+)/gu)].map((m) => m[1]).filter((t) => !/^\d+$/.test(t));

  return {
    summary,
    decisions: decisionsAt !== -1 ? bulletsAfter(lines, decisionsAt) : [],
    actionItems,
    category: category || undefined,
    account: account && !/^general$/i.test(account) ? account : undefined,
    tags,
  };
}

/** The Tasks plugin's priority markers. */
const PRIORITY_MARK = { High: "⏫", Medium: "🔼", Low: "🔽" } as const;

/**
 * An action item as a task line, in the Tasks plugin's format: owner in the
 * text, then priority, created date (`created`, if given) and due date.
 */
export function actionLine(item: ActionItem, created?: string): string {
  const added = created ? `➕ ${created}` : "";
  if (item.raw !== undefined) return [`- [ ] ${item.raw}`, added].filter(Boolean).join(" ");
  return [
    `- [ ] ${item.task}`,
    item.person ? `@[[${item.person}]]` : "",
    item.role ? `(owner: ${item.role})` : "",
    item.priority ? PRIORITY_MARK[item.priority] : "",
    added,
    item.due ? `📅 ${item.due}` : "",
  ].filter(Boolean).join(" ");
}

/** A task or bullet reduced to its wording, for spotting one that is already in the note. */
function sameItem(line: string): string {
  return line
    .replace(BULLET_RE, "")
    .replace(/(?:📅|➕|✅|⏳|🛫)\s*\d{4}-\d{2}-\d{2}/gu, "")
    .replace(/[⏫🔼🔽🔺⏬]/gu, "")
    .replace(/\((?:priority|owner):[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface ApplyResult {
  content: string;
  decisions: number;
  actionItems: number;
}

/**
 * File the reply into the note: the summary replaces Meeting Summary;
 * decisions and action items not already in their sections are added; the
 * category, account and tags become properties when `saveProperties` is set.
 * New action items are stamped with `today` as their created date.
 * Applying the same reply twice changes nothing the second time.
 */
export function applyReply(content: string, reply: AssistantReply, saveProperties: boolean, today?: string): ApplyResult {
  let out = content;
  if (reply.summary.length > 0) out = replaceSection(out, SUMMARY_SECTIONS, reply.summary, TRANSCRIPT_SECTIONS);

  const fresh = (names: string[], candidates: string[]) => {
    const seen = new Set(sectionLines(out, names).map(sameItem));
    return candidates.filter((line) => {
      const key = sameItem(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const decisions = fresh(DECISIONS_SECTIONS, reply.decisions.map((d) => `- ${d}`));
  if (decisions.length > 0) out = appendToSection(out, DECISIONS_SECTIONS, decisions, ACTION_SECTIONS);
  const actions = fresh(ACTION_SECTIONS, reply.actionItems.map((item) => actionLine(item, today)));
  if (actions.length > 0) out = appendToSection(out, ACTION_SECTIONS, actions, SUMMARY_SECTIONS);

  if (saveProperties) {
    if (reply.category) out = setFrontmatterValue(out, "meeting_category", reply.category);
    if (reply.account) out = setFrontmatterValue(out, "account", reply.account);
    if (reply.tags.length > 0) out = addFrontmatterTags(out, reply.tags);
  }
  return { content: out, decisions: decisions.length, actionItems: actions.length };
}
