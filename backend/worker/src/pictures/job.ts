import { issueAgentToken, revokeAgentToken } from '@robis/auth';
import { type Database, posts, workspaces } from '@robis/database';
import { and, isNotNull, sql } from 'drizzle-orm';
import type { JobHandler } from '../runner.ts';
import {
  type Fetcher,
  fetchPicture,
  fromNasa,
  fromOpenverse,
  fromWikimedia,
  type Picture,
} from './sources.ts';

/**
 * The pictures agent (Phase 2c): a picture a day on each feed that chose
 * one, from a public image library, credited and openly licensed; on some
 * days, when the picture is free to change, as a meme. Scripted: no model,
 * and nothing from Robis is sent to the libraries.
 *
 * It posts as its agent through the API, with a token made for the run and
 * revoked when it ends, so the post goes through the same checks, storage
 * limit, re-encoding, audit trail and take-down as anyone's.
 */

export const PICTURES_JOB = 'pictures.post';
/** How often it looks; each workspace still gets at most one picture a day. */
export const PICTURES_INTERVAL_MS = 60 * 60 * 1000;
const RUN_TOKEN_TTL_MS = 5 * 60_000;
/** A generic name for the libraries' logs: nothing about who runs this server. */
const DEFAULT_USER_AGENT = 'robis-pictures/1.0 (an open source team workspace)';

/**
 * The meme captions, drawn by the API on a free-to-change picture: about the
 * work, never about a person.
 */
export const MEME_CAPTIONS: readonly string[] = [
  'When the standup ends five minutes early',
  'Me, checking the board after the weekend',
  'The build after one more small change',
  'Friday deploys, seen from a safe distance',
  'When the bug fixes itself on the second try',
  'Inbox zero, as it really looks',
  'Waiting for the review like',
  'The team when the demo just works',
  'My calendar, between meetings',
  'Shipping it, at last',
];

const dayOf = (now: Date) => Math.floor(now.getTime() / 86_400_000);

/** Today's picture: the library changes by day, so the feed is not all space. */
export async function pictureFor(
  fetcher: Fetcher,
  now: Date,
  userAgent: string,
): Promise<Picture | null> {
  const day = dayOf(now);
  const order = [
    () => fromWikimedia(fetcher, now, userAgent),
    () => fromNasa(fetcher, day, userAgent),
    () => fromOpenverse(fetcher, day, userAgent),
  ];
  // Start at today's library; if it has nothing usable, try the next.
  for (let i = 0; i < order.length; i++) {
    const found = await order[(day + i) % order.length]!().catch(() => null);
    if (found) return found;
  }
  return null;
}

/** The credit under the picture: what, who, the licence, and where to see it. */
export function creditOf(picture: Picture, meme: string | null): string {
  const lines = [
    meme ?? picture.title,
    `${meme ? `${picture.title}, by ` : 'By '}${picture.creator}. ${picture.licence}, via ${picture.source}: ${picture.landingUrl}`,
  ];
  if (meme) lines.push('Caption added by Robis.');
  return lines.join('\n');
}

/** Workspaces with a pictures agent that has not posted a picture today. */
async function due(db: Database, now: Date) {
  const start = new Date(dayOf(now) * 86_400_000).toISOString();
  return db
    .select({ workspaceId: workspaces.id, agentId: workspaces.picturesAgentId })
    .from(workspaces)
    .where(
      and(
        isNotNull(workspaces.picturesAgentId),
        sql`not exists (
          select 1 from ${posts}
          where ${posts.workspaceId} = ${workspaces.id}
            and ${posts.authorId} = ${workspaces.picturesAgentId}
            and ${posts.kind} = 'photo'
            and ${posts.createdAt} >= ${start}::timestamptz
        )`,
      ),
    );
}

type Options = {
  /** The API, from inside the stack. */
  apiUrl: string;
  /** For the libraries; tests hand in canned answers. */
  fetcher?: Fetcher;
  /** For the API; tests reach the app in-process. */
  apiFetcher?: Fetcher;
  userAgent?: string;
  now?: () => Date;
};

/** Post one picture as the agent: the photo, then its credit as the words. */
async function post(
  options: Options,
  token: string,
  workspaceId: string,
  bytes: Uint8Array,
  credit: string,
  day: number,
  meme: string | null,
) {
  const api = options.apiFetcher ?? fetch;
  const headers = { authorization: `Bearer ${token}` };
  const made = await api(`${options.apiUrl}/workspaces/${workspaceId}/posts/photo`, {
    method: 'POST',
    // Keyed by workspace and day: a retried job posts the same picture once.
    headers: {
      ...headers,
      'content-type': 'image/jpeg',
      'idempotency-key': `pictures:${workspaceId}:${day}`,
      // The API draws the caption: it alone holds the image library.
      ...(meme ? { 'x-robis-meme-caption': encodeURIComponent(meme) } : {}),
    },
    body: new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
  });
  if (!made.ok) throw new Error(`posting: HTTP ${made.status}`);
  const { post: created } = (await made.json()) as { post: { id: string } };
  const captioned = await api(`${options.apiUrl}/workspaces/${workspaceId}/posts/${created.id}`, {
    method: 'PATCH',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ body: credit }),
  });
  if (!captioned.ok) throw new Error(`credit: HTTP ${captioned.status}`);
}

/** Today's picture, fetched, as a meme on its days, with its credit; null if none. */
async function today(fetcher: Fetcher, now: Date, userAgent: string) {
  const picture = await pictureFor(fetcher, now, userAgent);
  if (!picture) return null;
  const original = await fetchPicture(fetcher, picture, userAgent);
  const day = dayOf(now);
  // Every third day, when the picture is free to change, a meme.
  const meme =
    picture.freeToChange && day % 3 === 0 ? MEME_CAPTIONS[day % MEME_CAPTIONS.length]! : null;
  return { day, bytes: original, meme, credit: creditOf(picture, meme) };
}

export function picturesHandler(options: Options): JobHandler {
  const fetcher = options.fetcher ?? fetch;
  const userAgent = options.userAgent || DEFAULT_USER_AGENT;
  return async (_payload, { db }) => {
    const now = options.now?.() ?? new Date();
    const targets = await due(db, now);
    if (targets.length === 0) return;
    const found = await today(fetcher, now, userAgent);
    if (!found) {
      console.warn('pictures: no usable picture from any library today');
      return;
    }
    for (const { workspaceId, agentId } of targets) {
      if (!agentId) continue;
      const token = await issueAgentToken(db, {
        agentId,
        workspaceId,
        createdBy: agentId,
        label: 'pictures run',
        expiresAt: new Date(Date.now() + RUN_TOKEN_TTL_MS),
      });
      try {
        await post(
          options,
          token.secret,
          workspaceId,
          found.bytes,
          found.credit,
          found.day,
          found.meme,
        );
      } catch (error) {
        console.warn(`pictures: workspace ${workspaceId} skipped: ${(error as Error).message}`);
      } finally {
        await revokeAgentToken(db, { tokenId: token.id, agentId, workspaceId }).catch(
          () => undefined,
        );
      }
    }
  };
}
