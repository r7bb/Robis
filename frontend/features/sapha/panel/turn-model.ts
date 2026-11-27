import {
  intentFromParts,
  LOOKING_INTENTS,
  type SaphaCited,
  type SaphaIntent,
  type SaphaParts,
  type SaphaTurn,
} from '@robis/shared';

/**
 * Sapha's panel, the parts with no browser (the agent): which keys in an
 * answer become links, which proposals become cards, the shortcut, and
 * whether an answer is still on its way. Pure, so tested on its own.
 */

/** A change Sapha may propose: anything but looking. */
export type Change = Exclude<
  SaphaIntent,
  { kind: 'open' | 'search' | 'go' | 'blockers' | 'about' | 'cycle' | 'release' }
>;

export type Segment = { text: string } | { text: string; issue: SaphaCited };

const KEY_IN_TEXT = /(?<![A-Za-z0-9])[A-Za-z][A-Za-z0-9]{0,9}-\d{1,9}(?![A-Za-z0-9])/g;

/**
 * An answer as plain words and links: a key becomes a link only when Sapha
 * looked at that issue, so a key it made up, or one from a quoted comment,
 * stays plain text.
 */
export function linkIssues(text: string, cited: readonly SaphaCited[]): Segment[] {
  const byKey = new Map(cited.map((issue) => [issue.key.toUpperCase(), issue]));
  const segments: Segment[] = [];
  let at = 0;
  for (const match of text.matchAll(KEY_IN_TEXT)) {
    const issue = byKey.get(match[0].toUpperCase());
    if (!issue) continue;
    if (match.index > at) segments.push({ text: text.slice(at, match.index) });
    segments.push({ text: match[0], issue });
    at = match.index + match[0].length;
  }
  if (at < text.length) segments.push({ text: text.slice(at) });
  return segments;
}

/** The proposals that still read as changes, worked out on this person's clock. */
export function changesOf(proposals: readonly SaphaParts[], now: Date): Change[] {
  return proposals.flatMap((parts) => {
    const intent = intentFromParts(parts, now);
    return intent && !LOOKING_INTENTS.has(intent.kind) ? [intent as Change] : [];
  });
}

type KeyLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/** Ctrl J or Cmd J: the panel, from anywhere in a workspace. */
export function isSaphaShortcut(event: KeyLike): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'j'
  );
}

/** Whether Sapha is still working out the last answer. */
export function stillAnswering(turns: readonly SaphaTurn[]): boolean {
  return turns.at(-1)?.status === 'pending';
}

/** What to ask an empty conversation, about one issue when opened from it. */
export function startersAbout(key: string | null): readonly string[] {
  if (!key) {
    return ['What is on my plate today?', 'What keeps slipping?', 'Which releases are coming up?'];
  }
  return [
    `What is ${key} waiting on?`,
    `Sum up ${key} and its latest comments`,
    `Who could take ${key} on?`,
  ];
}

/** The composer's first words when opened from an issue, so a question about "this" names it. */
export function aboutDraft(key: string | null): string {
  return key ? `About ${key}: ` : '';
}

/** Whether the draft asks something: not empty, and more than the issue's name typed for them. */
export function hasQuestion(draft: string, about: string | null): boolean {
  const words = draft.trim();
  return words.length > 0 && words !== aboutDraft(about).trim();
}

/** The question to ask again when the latest answer failed: the words just before it. */
export function retryOf(turns: readonly SaphaTurn[]): string | null {
  const last = turns.at(-1);
  const asked = turns.at(-2);
  if (last?.role !== 'sapha' || last.status !== 'failed') return null;
  return asked?.role === 'person' ? asked.text : null;
}

/** The last question asked in a conversation, for Up in an empty composer. */
export function lastAsked(turns: readonly SaphaTurn[]): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]?.role === 'person') return turns[i]?.text ?? null;
  }
  return null;
}
