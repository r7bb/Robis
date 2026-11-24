/**
 * Follow-ups in meeting notes: a checklist line ("- [ ] Send the budget"),
 * or one starting TODO, Action or Follow-up. Each can become an issue; once
 * made, its line is ticked and ends with the issue's key in brackets, so it
 * reads as done and is never made twice. Lines are counted from 0.
 */

export type FollowUp = { line: number; text: string; done: boolean; key: string | null };

/** The most a meeting's notes may hold. */
export const MEETING_NOTES_MAX_LENGTH = 20_000;

const CHECKLIST = /^\s*[-*]\s*\[( |x|X)\]\s+(.+?)\s*$/;
const LABELLED = /^\s*(?:todo|action|follow[- ]?up)\s*:\s*(.+?)\s*$/i;
const TRAILING_KEY = /\s*\(([A-Za-z][A-Za-z0-9]{0,9}-\d{1,9})\)$/;

function read(raw: string, line: number): FollowUp | null {
  const checked = CHECKLIST.exec(raw);
  const labelled = checked ? null : LABELLED.exec(raw);
  const body = checked?.[2] ?? labelled?.[1];
  if (!body) return null;
  const key = TRAILING_KEY.exec(body)?.[1]?.toUpperCase() ?? null;
  const text = body.replace(TRAILING_KEY, '').trim();
  if (!text) return null;
  const ticked = checked ? checked[1]!.toLowerCase() === 'x' : false;
  return { line, text, done: ticked || key !== null, key };
}

/** Every follow-up in the notes, in order. */
export function followUpsIn(notes: string): FollowUp[] {
  return notes.split('\n').flatMap((raw, line) => read(raw, line) ?? []);
}

/** The notes with one follow-up ticked and its issue's key added; unchanged otherwise. */
export function markFollowUp(notes: string, line: number, key: string): string {
  const lines = notes.split('\n');
  const found = lines[line] === undefined ? null : read(lines[line]!, line);
  if (!found) return notes;
  return lines.map((raw, at) => (at === line ? `- [x] ${found.text} (${key})` : raw)).join('\n');
}
