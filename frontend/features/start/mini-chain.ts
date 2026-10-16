/**
 * A small hash chain that runs in the browser: the audit trail's idea, made
 * touchable on the intro.
 *
 * Real SHA-256 through Web Crypto, over the event's text and the previous
 * link, exactly the shape of the server's chain without its key or its
 * fields. Editing an event changes only that event's text; its stored hash
 * stays as it was written, so the check finds the edit the way the real
 * verification would.
 */

export type ChainLink = {
  text: string;
  /** The previous link's hash; null for the first. */
  prev: string | null;
  /** The hash as written when the event was recorded. */
  hash: string;
};

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const linkHash = (prev: string | null, text: string) => sha256(`${prev ?? ''}\x1f${text}`);

/** Record a list of events as a chain, each hash covering the one before. */
export async function buildChain(events: readonly string[]): Promise<ChainLink[]> {
  const chain: ChainLink[] = [];
  let prev: string | null = null;
  for (const text of events) {
    const hash = await linkHash(prev, text);
    chain.push({ text, prev, hash });
    prev = hash;
  }
  return chain;
}

/** A new chain with one event's text changed and everything else as written. */
export function editEvent(chain: readonly ChainLink[], index: number, text: string): ChainLink[] {
  return chain.map((link, i) => (i === index ? { ...link, text } : link));
}

/** The index of the first link that no longer holds, or null if all do. */
export async function findBreak(chain: readonly ChainLink[]): Promise<number | null> {
  let prev: string | null = null;
  for (const [index, link] of chain.entries()) {
    if (link.prev !== prev || (await linkHash(prev, link.text)) !== link.hash) return index;
    prev = link.hash;
  }
  return null;
}
