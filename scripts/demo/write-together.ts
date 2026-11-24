/**
 * Two teammates writing in one document at once (demo:life): every few
 * minutes two of the demo's people open the same sample document over the
 * realtime socket, as a browser does, show their cursors, and type a line
 * each, a few characters at a time, so anyone watching sees both carets
 * move and both lines appear. Edits go through the document's CRDT, so the
 * two never overwrite each other.
 */

import * as Y from 'yjs';
import type { Actor, Stack } from './client.ts';
import { NOTES_KEPT, SAMPLE_DOCUMENTS, type SampleDocument } from './doc-content.ts';
import { pickFresh, pickOne, type Random } from './plan.ts';

type Writer = Pick<Actor, 'name' | 'call'> & { cookie: string };

const TYPE_STEP_MS = 120;
const CHARS_PER_STEP = 3;
const SYNC_WAIT_MS = 5_000;

const encode = (update: Uint8Array) => Buffer.from(update).toString('base64');
const decode = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));

/**
 * Where a new note goes: the end of the text. When more than `NOTES_KEPT`
 * notes are there, the oldest one gives way, so the document stays a page.
 */
export function oldestNoteToDrop(text: string): { from: number; length: number } | null {
  const start = text.indexOf('\nNotes\n');
  if (start === -1) return null;
  const notes = text
    .slice(start + '\nNotes\n'.length)
    .split('\n')
    .filter((line) => line.startsWith('- '));
  if (notes.length < NOTES_KEPT) return null;
  const first = text.indexOf(notes[0]!, start);
  return { from: first, length: notes[0]!.length + 1 };
}

/** One person with a document open over the socket. */
class OpenDocument {
  readonly doc = new Y.Doc();
  private readonly socket: WebSocket;
  private synced: Promise<void>;

  constructor(
    stack: Stack,
    writer: Writer,
    private readonly workspaceId: string,
    private readonly documentId: string,
  ) {
    this.socket = new WebSocket(`${stack.web.replace(/^http/, 'ws')}/ws`, {
      headers: { cookie: writer.cookie, origin: stack.origin },
    } as unknown as string[]);
    this.synced = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the document did not sync')), SYNC_WAIT_MS);
      this.socket.addEventListener('open', () => {
        this.send({ type: 'subscribe', workspaceId: this.workspaceId });
        this.send({ type: 'doc.open', documentId: this.documentId });
      });
      this.socket.addEventListener('message', (raw) => {
        const message = JSON.parse(String(raw.data)) as {
          type: string;
          documentId?: string;
          update?: string;
        };
        if (message.documentId !== this.documentId || !message.update) return;
        if (message.type === 'doc.sync' || message.type === 'doc.update') {
          Y.applyUpdate(this.doc, decode(message.update), 'remote');
        }
        if (message.type === 'doc.sync') {
          clearTimeout(timer);
          resolve();
        }
      });
      this.socket.addEventListener('error', () => reject(new Error('the socket failed')));
    });
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') {
        this.send({ type: 'doc.update', documentId: this.documentId, update: encode(update) });
      }
    });
  }

  ready() {
    return this.synced;
  }

  private send(message: unknown) {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  get text() {
    return this.doc.getText('content');
  }

  cursor(at: number | null) {
    this.send({ type: 'doc.awareness', documentId: this.documentId, state: { cursor: at } });
  }

  /** Type `line` at the end, a few characters at a time, the caret following. */
  async type(line: string) {
    const text = this.text;
    const drop = oldestNoteToDrop(text.toString());
    if (drop) text.delete(drop.from, drop.length);
    let at = text.length;
    if (!text.toString().endsWith('\n')) {
      text.insert(at, '\n');
      at += 1;
    }
    for (let i = 0; i < line.length; i += CHARS_PER_STEP) {
      const piece = line.slice(i, i + CHARS_PER_STEP);
      // Another writer may have added text meanwhile: keep to the end of ours.
      at = Math.min(at, text.length);
      text.insert(at, piece);
      at += piece.length;
      this.cursor(at);
      await Bun.sleep(TYPE_STEP_MS);
    }
    text.insert(Math.min(at, text.length), '\n');
  }

  close() {
    this.cursor(null);
    this.send({ type: 'doc.close', documentId: this.documentId });
    this.socket.close();
    this.doc.destroy();
  }
}

/** The demo's sample documents, made with their opening when missing. */
async function sampleDocuments(stack: Stack, writer: Writer, workspaceId: string) {
  const base = `/workspaces/${workspaceId}/documents`;
  const { documents } = await writer.call<{ documents: { id: string; title: string }[] }>(
    'GET',
    base,
  );
  const found: { id: string; sample: SampleDocument }[] = [];
  for (const sample of SAMPLE_DOCUMENTS) {
    const existing = documents.find((d) => d.title === sample.title);
    if (existing) {
      found.push({ id: existing.id, sample });
      continue;
    }
    const { document } = await writer.call<{ document: { id: string } }>('POST', base, {
      title: sample.title,
    });
    const open = new OpenDocument(stack, writer, workspaceId, document.id);
    await open.ready();
    open.text.insert(0, sample.opening);
    await Bun.sleep(500);
    open.close();
    found.push({ id: document.id, sample });
  }
  return found;
}

/**
 * One session of writing together: two people, one document, a line each,
 * typed at the same time. Returns what to log.
 */
export async function writeTogether(
  stack: Stack,
  writers: readonly Writer[],
  workspaceId: string,
  random: Random,
  recent: string[],
): Promise<string | null> {
  if (writers.length < 2) return null;
  const docs = await sampleDocuments(stack, writers[0]!, workspaceId);
  const chosen = pickOne(docs, random);
  if (!chosen) return null;
  const first = pickOne(writers, random)!;
  const second = pickOne(
    writers.filter((w) => w !== first),
    random,
  )!;
  const pair = [first, second].map((w) => new OpenDocument(stack, w, workspaceId, chosen.id));
  try {
    await Promise.all(pair.map((open) => open.ready()));
    const lines = pair.map(() => {
      const line = pickFresh(chosen.sample.lines, recent, random);
      recent.push(line);
      return line;
    });
    // The second starts a moment after the first, as people do.
    await Promise.all(
      pair.map(async (open, i) => {
        await Bun.sleep(i * 1_500);
        await open.type(lines[i]!);
      }),
    );
    await Bun.sleep(2_000);
    return `${first.name} and ${second.name} wrote together in ${chosen.sample.title}`;
  } finally {
    for (const open of pair) open.close();
  }
}
