/**
 * Issue keys in what people write (REL-4), so chat can link them to the
 * issue. Only a prefix that is one of the workspace's project keys counts,
 * so "COVID-19" or "B-52" stays plain text. Text is split, never parsed as
 * markup: a part is either plain text or a key.
 */

export type TextPart = { text: string } | { key: string };

/** Letters and digits, a hyphen, a number, as a whole word. */
const KEY = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{0,9})-(\d{1,9})(?![A-Za-z0-9])/g;

export function splitIssueKeys(text: string, prefixes: ReadonlySet<string>): TextPart[] {
  if (prefixes.size === 0) return [{ text }];
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(KEY)) {
    const prefix = match[1]!.toUpperCase();
    if (!prefixes.has(prefix)) continue;
    const start = match.index!;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ key: `${prefix}-${Number(match[2])}` });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts.length > 0 ? parts : [{ text }];
}

/** What a Discuss button puts in the message box: the key, ready to talk about it. */
export function discussDraft(key: string): string {
  return `${key} `;
}
