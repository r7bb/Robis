import { diffEdit, type TextEdit } from '@robis/shared';
import * as Y from 'yjs';

/**
 * Two people, one piece of text, and a network you can cut.
 *
 * The landing page's live demo runs on this. Each side is a real Yjs
 * document, the same CRDT the documents feature uses, and "the network" is
 * just whether updates are relayed between them. Cut it, type on both
 * sides, restore it, and the merge is the genuine one: the missing updates
 * are exchanged by state vector, exactly as a client catching up does.
 *
 * Kept free of React and the DOM so it can be tested directly. The demo is
 * the one interactive claim on the marketing page, and `tests/landing-sync`
 * holds it to that claim.
 */

export type Side = 'you' | 'mia';

const SIDES: readonly Side[] = ['you', 'mia'];

/** Marks updates applied by the relay, so they are not relayed back. */
const RELAY = Symbol('relay');

function other(side: Side): Side {
  return side === 'you' ? 'mia' : 'you';
}

export class SyncPair {
  private readonly docs: Record<Side, Y.Doc>;
  private online = true;
  private waiting: Record<Side, number> = { you: 0, mia: 0 };
  private readonly listeners = new Set<() => void>();

  constructor(seed: string) {
    this.docs = { you: new Y.Doc(), mia: new Y.Doc() };

    // One shared starting point: Mia's document is built from Your updates
    // rather than seeded separately, which would give the two sides two
    // unrelated histories that merge into the seed written twice.
    this.docs.you.getText('body').insert(0, seed);
    Y.applyUpdate(this.docs.mia, Y.encodeStateAsUpdate(this.docs.you), RELAY);

    for (const side of SIDES) {
      this.docs[side].on('update', (update: Uint8Array, origin: unknown) => {
        if (this.online && origin !== RELAY) {
          Y.applyUpdate(this.docs[other(side)], update, RELAY);
        }
        this.emit();
      });
    }
  }

  text(side: Side): string {
    return this.docs[side].getText('body').toString();
  }

  isOnline(): boolean {
    return this.online;
  }

  /** Edits made on this side since the network was cut. */
  pending(side: Side): number {
    return this.waiting[side];
  }

  /** Replace one side's text, applied as the smallest equivalent edit. */
  edit(side: Side, next: string): void {
    const current = this.text(side);
    if (current === next) return;

    const { from, to, insert } = diffEdit(current, next);
    const body = this.docs[side].getText('body');

    this.docs[side].transact(() => {
      if (to > from) body.delete(from, to - from);
      if (insert) body.insert(from, insert);
    });

    if (!this.online) this.waiting = { ...this.waiting, [side]: this.waiting[side] + 1 };
    this.emit();
  }

  /**
   * Cut or restore the link. Restoring exchanges whatever each side is
   * missing and reports how many offline edits were merged.
   */
  setOnline(online: boolean): { merged: number } {
    if (online === this.online) return { merged: 0 };

    this.online = online;
    if (!online) {
      this.emit();
      return { merged: 0 };
    }

    const merged = this.waiting.you + this.waiting.mia;
    this.waiting = { you: 0, mia: 0 };

    const { you, mia } = this.docs;
    const forMia = Y.encodeStateAsUpdate(you, Y.encodeStateVector(mia));
    const forYou = Y.encodeStateAsUpdate(mia, Y.encodeStateVector(you));
    Y.applyUpdate(mia, forMia, RELAY);
    Y.applyUpdate(you, forYou, RELAY);

    this.emit();
    return { merged };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * Where a caret should sit after somebody else's edit lands.
 *
 * Without this, every remote keystroke would throw the local caret to the
 * end of the field, which makes typing on both sides at once impossible.
 */
export function shiftCaret(caret: number, edit: TextEdit): number {
  if (caret <= edit.from) return caret;
  if (caret >= edit.to) return caret + edit.insert.length - (edit.to - edit.from);
  return edit.from + edit.insert.length;
}
