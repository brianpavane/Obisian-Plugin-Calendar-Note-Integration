/**
 * @file gemini.ts
 * @description The copy/paste round trip with Gemini: build a prompt from a
 * meeting note, and put Gemini's reply into the note's sections. The plugin
 * never contacts Gemini itself.
 */

import { appendToSection, sectionText } from "./sections";

export const SUMMARY_SECTIONS = ["Meeting Summary", "Summary"];
export const DECISIONS_SECTIONS = ["Decisions"];
export const ACTION_SECTIONS = ["Action items"];
export const NOTES_SECTIONS = ["Notes"];
export const TRANSCRIPT_SECTIONS = ["Transcript"];

export interface MeetingInfo {
  title: string;
  /** e.g. "2026-10-06 09:00–10:00" */
  when: string;
  /** The meeting's date (YYYY-MM-DD), for turning "by Friday" into a date. */
  date: string;
  attendees: string[];
}

/** The prompt to paste into Gemini, or undefined if the note has neither notes nor a transcript. */
export function buildPrompt(content: string, meeting: MeetingInfo): string | undefined {
  const notes = sectionText(content, NOTES_SECTIONS);
  const transcript = sectionText(content, TRANSCRIPT_SECTIONS);
  if (!notes && !transcript) return undefined;

  return [
    "Write up the meeting below from my notes and the transcript.",
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
    "For each action item, add the owner as @ followed by their first name (for example @Bob) when it's clear who owns it,",
    `and a due date as 📅 YYYY-MM-DD when one was mentioned. The meeting was on ${meeting.date}; turn relative dates such as "by Friday" into dates.`,
    "Use only what's in the notes and transcript; don't invent tasks, owners or dates.",
    "",
    "---",
    "",
    `Meeting: ${meeting.title}`,
    `When: ${meeting.when}`,
    ...(meeting.attendees.length > 0 ? [`Attendees: ${meeting.attendees.join(", ")}`] : []),
    "",
    "My notes:",
    notes || "(none)",
    "",
    "Transcript:",
    transcript || "(none)",
  ].join("\n");
}

export interface GeminiReply {
  summary: string[];
  decisions: string[];
  actionItems: string[];
}

const REPLY_HEADING_RE = /^\s*(?:#{1,6}\s*|\*\*)?\s*(summary|decisions|action items)\s*:?\s*(?:\*\*)?\s*:?\s*$/i;
const BULLET_RE = /^\s*(?:[-*+•]|\d+[.)])\s+(?:\[[ xX]?\]\s*)?/;

function trim(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && !out[0].trim()) out.shift();
  while (out.length > 0 && !out[out.length - 1].trim()) out.pop();
  return out;
}

function bullets(lines: string[]): string[] {
  return lines
    .filter((l) => l.trim())
    .map((l) => l.replace(BULLET_RE, "").trim())
    .filter((l) => l && !/^none\.?$/i.test(l));
}

/** The three parts of a Gemini reply, or undefined if it has none of the expected headings. */
export function parseReply(text: string): GeminiReply | undefined {
  const parts: Record<string, string[]> = {};
  let current: string | undefined;
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(raw)) continue;
    const heading = raw.match(REPLY_HEADING_RE);
    if (heading) {
      current = heading[1].toLowerCase();
      parts[current] = [];
    } else if (current) {
      parts[current].push(raw.replace(/\s+$/, ""));
    }
  }
  if (Object.keys(parts).length === 0) return undefined;
  return {
    summary: trim(parts["summary"] ?? []),
    decisions: bullets(parts["decisions"] ?? []).map((l) => `- ${l}`),
    actionItems: bullets(parts["action items"] ?? []).map((l) => `- [ ] ${l}`),
  };
}

/** Add the reply to the note: summary, decisions and action items each go to the end of their section. */
export function applyReply(content: string, reply: GeminiReply): string {
  let out = content;
  if (reply.summary.length > 0) out = appendToSection(out, SUMMARY_SECTIONS, reply.summary, TRANSCRIPT_SECTIONS);
  if (reply.decisions.length > 0) out = appendToSection(out, DECISIONS_SECTIONS, reply.decisions, ACTION_SECTIONS);
  if (reply.actionItems.length > 0) out = appendToSection(out, ACTION_SECTIONS, reply.actionItems, SUMMARY_SECTIONS);
  return out;
}
