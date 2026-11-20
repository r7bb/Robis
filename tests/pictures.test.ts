import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { agentTokens, posts } from '@robis/database';
import { creditOf, pictureFor, picturesHandler } from '@robis/worker/pictures';
import { allowedUrl, fetchAllowed } from '@robis/worker/pictures-sources';
import { and, eq, isNull } from 'drizzle-orm';
import sharp from 'sharp';
import {
  closeHarness,
  createActor,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * The pictures agent (Phase 2c): a credited, openly licensed picture a day
 * from public image libraries, sometimes as a meme. Done when: it posts once
 * a day as its agent, only where one was chosen, only under an allowed
 * licence and with its credit, only from allowed hosts, re-encoded like any
 * upload, and its run token is revoked. Never touches the network: the
 * libraries' answers here are canned.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const SECRET = 'LOCATION-35.6762N-139.6503E';
// Day 20412 (2025-11-20 is not used; 2026-11-20 is day 20777): 20777 % 3 = 2, no meme.
const PLAIN_DAY = new Date('2026-11-20T09:00:00Z');
// 2026-11-21 is day 20778: 20778 % 3 = 0, a meme when the picture is free to change.
const MEME_DAY = new Date('2026-11-21T09:00:00Z');

async function jpeg() {
  return sharp({ create: { width: 1200, height: 800, channels: 3, background: '#0ea5e9' } })
    .jpeg()
    .withExif({ IFD0: { Artist: SECRET } })
    .toBuffer();
}

/** The three libraries, canned. `licence` sets Wikimedia's picture of the day. */
function libraries(licence = 'CC BY-SA 4.0') {
  const asked: string[] = [];
  const fetcher = async (input: string) => {
    asked.push(input);
    const url = new URL(input);
    if (url.hostname === 'api.wikimedia.org') {
      return Response.json({
        image: {
          title: 'File:Mountain lake at dawn.jpg',
          thumbnail: { source: 'https://upload.wikimedia.org/lake.jpg' },
          artist: { text: 'A. Photographer' },
          license: { type: licence },
          file_page: 'https://commons.wikimedia.org/wiki/File:Mountain_lake_at_dawn.jpg',
        },
      });
    }
    if (url.hostname === 'images-api.nasa.gov') {
      return Response.json({
        collection: {
          items: [
            {
              data: [{ title: 'Aurora over the Pacific', nasa_id: 'iss071', center: 'JSC' }],
              links: [{ href: 'https://images-assets.nasa.gov/image/iss071/iss071~thumb.jpg' }],
            },
          ],
        },
      });
    }
    if (url.hostname === 'api.openverse.org' && url.pathname === '/v1/images/') {
      return Response.json({ results: [] });
    }
    if (['upload.wikimedia.org', 'images-assets.nasa.gov'].includes(url.hostname)) {
      return new Response(await jpeg(), { headers: { 'content-type': 'image/jpeg' } });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetcher, asked };
}

/** The API, in-process, with binary bodies: what the worker would reach over the network. */
async function apiFetcher(input: string, init?: RequestInit): Promise<Response> {
  const { app } = await getHarness();
  const url = new URL(input);
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    headers[key] = value;
  });
  const body = init?.body;
  const reply = await app.inject({
    method: (init?.method ?? 'GET') as 'GET',
    url: `${url.pathname}${url.search}`,
    headers,
    payload:
      typeof body === 'string'
        ? body
        : body instanceof Blob
          ? Buffer.from(await body.arrayBuffer())
          : undefined,
  });
  return new Response(reply.statusCode === 204 ? null : reply.body, { status: reply.statusCode });
}

async function setUp({ pictures = true, role = 'MEMBER' } = {}) {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const created = await request(`/workspaces/${workspace.id}/agents`, {
    method: 'POST',
    actor: owner,
    payload: { name: 'Pictures bot', role, pictures },
  });
  return { owner, workspace, agentId: created.json().agent.id as string };
}

const run = (fetcher: ReturnType<typeof libraries>['fetcher'], now: Date) => async () => {
  const handler = picturesHandler({
    apiUrl: 'http://api.internal',
    fetcher,
    apiFetcher,
    now: () => now,
  });
  await handler({}, { db: (await getHarness()).workerDb });
};

describe('a picture a day', () => {
  test('posts once a day as its agent, credited, re-encoded, and revokes its run token', async () => {
    const { owner, workspace, agentId } = await setUp();
    const { fetcher } = libraries();
    await run(fetcher, PLAIN_DAY)();
    await run(fetcher, PLAIN_DAY)();

    const feed = (await request(`/workspaces/${workspace.id}/feed`, { actor: owner })).json();
    const mine = feed.items.filter(
      (i: { post?: { authorId: string } }) => i.post?.authorId === agentId,
    );
    expect(mine).toHaveLength(1);
    const { post } = mine[0];
    expect(post.kind).toBe('photo');
    expect(post.body).toContain('CC BY-SA 4.0');
    expect(post.body).toContain('Wikimedia Commons');
    expect(post.body).toContain('A. Photographer');

    const { app, ownerDb } = await getHarness();
    const served = await app.inject({
      method: 'GET',
      url: post.photo.url,
      headers: { cookie: owner.cookie },
    });
    expect(served.rawPayload.includes(SECRET)).toBe(false);
    const open = await ownerDb
      .select()
      .from(agentTokens)
      .where(
        and(
          eq(agentTokens.agentId, agentId),
          isNull(agentTokens.revokedAt),
          eq(agentTokens.label, 'pictures run'),
        ),
      );
    expect(open).toEqual([]);
  });

  test('nothing where no agent was chosen, and nothing from a guest agent', async () => {
    const none = await setUp({ pictures: false });
    const guest = await setUp({ role: 'GUEST' });
    const { fetcher, asked } = libraries();
    await run(fetcher, PLAIN_DAY)();
    const { ownerDb } = await getHarness();
    expect(
      await ownerDb.select().from(posts).where(eq(posts.workspaceId, none.workspace.id)),
    ).toEqual([]);
    expect(
      await ownerDb.select().from(posts).where(eq(posts.workspaceId, guest.workspace.id)),
    ).toEqual([]);
    // With only a guest agent wanting one, the library was still asked once:
    // the refusal is the API's, as it would be for anyone.
    expect(asked.length).toBeGreaterThan(0);
  });

  test('with no workspace wanting one, no library is asked at all', async () => {
    await setUp({ pictures: false });
    const { fetcher, asked } = libraries();
    await run(fetcher, PLAIN_DAY)();
    expect(asked).toEqual([]);
  });
});

describe('licences and credit', () => {
  test('a picture under a licence that does not allow reuse is passed over for another library', async () => {
    const { fetcher } = libraries('All rights reserved');
    const picture = await pictureFor(fetcher, PLAIN_DAY, 'test');
    expect(picture?.source).toBe('NASA');
    expect(picture?.licence).toBe('Public domain');
  });

  test('only a free-to-change picture becomes a meme, and the credit says a caption was added', async () => {
    const { owner, workspace, agentId } = await setUp();
    const { fetcher } = libraries('Public domain');
    await run(fetcher, MEME_DAY)();
    const feed = (await request(`/workspaces/${workspace.id}/feed`, { actor: owner })).json();
    const post = feed.items.find(
      (i: { post?: { authorId: string } }) => i.post?.authorId === agentId,
    ).post;
    expect(post.body).toContain('Caption added by Robis.');

    const share = creditOf(
      {
        source: 'Wikimedia Commons',
        title: 'Lake',
        creator: 'A. Photographer',
        licence: 'CC BY-SA 4.0',
        freeToChange: false,
        landingUrl: 'https://commons.wikimedia.org/wiki/File:Lake.jpg',
        imageUrl: 'https://upload.wikimedia.org/lake.jpg',
      },
      null,
    );
    expect(share).toBe(
      'Lake\nBy A. Photographer. CC BY-SA 4.0, via Wikimedia Commons: https://commons.wikimedia.org/wiki/File:Lake.jpg',
    );
  });
});

describe('where it may fetch from', () => {
  test('HTTPS to the libraries’ own hosts only', () => {
    expect(allowedUrl('https://upload.wikimedia.org/a.jpg')).not.toBeNull();
    expect(allowedUrl('http://upload.wikimedia.org/a.jpg')).toBeNull();
    expect(allowedUrl('https://evil.example/a.jpg')).toBeNull();
    expect(allowedUrl('https://upload.wikimedia.org.evil.example/a.jpg')).toBeNull();
    expect(allowedUrl('not a url')).toBeNull();
  });

  test('a redirect to anywhere else is refused', async () => {
    const fetcher = async () =>
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } });
    await expect(
      fetchAllowed(fetcher, 'https://images-assets.nasa.gov/x.jpg', 'test'),
    ).rejects.toThrow('redirected elsewhere');
  });
});
