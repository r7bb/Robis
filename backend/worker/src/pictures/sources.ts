import { z } from 'zod';

/**
 * Where the pictures agent finds pictures (Phase 2c): three public image
 * libraries, each asked for openly licensed pictures only, over HTTPS, to
 * named hosts only. Nothing a person wrote in Robis is ever sent to them:
 * the searches are from the fixed lists below.
 *
 * Licences are checked here, not trusted: a picture is used only under a
 * licence that allows reuse with credit (public domain, CC0, CC BY, CC BY-SA),
 * and its credit travels with it.
 */

export type Picture = {
  source: 'NASA' | 'Wikimedia Commons' | 'Openverse';
  title: string;
  creator: string;
  /** As people say it: "Public domain", "CC0", "CC BY-SA 4.0". */
  licence: string;
  /** Public domain or CC0: free to change, so it may become a meme. */
  freeToChange: boolean;
  /** Where people can see the original and its licence. */
  landingUrl: string;
  /** The bytes to fetch, on an allowed host. */
  imageUrl: string;
};

/** The only hosts pictures and their listings are fetched from. */
export const ALLOWED_HOSTS = new Set([
  'images-api.nasa.gov',
  'images-assets.nasa.gov',
  'api.wikimedia.org',
  'upload.wikimedia.org',
  'api.openverse.org',
]);

/** Largest picture fetched, before it is decoded and re-encoded like any upload. */
export const MAX_PICTURE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

/** What is searched for, by day: calm, work-friendly, never people's faces by name. */
const NASA_TERMS = [
  'nebula',
  'aurora',
  'earth from space',
  'galaxy',
  'mars surface',
  'sunrise orbit',
];
const OPENVERSE_TERMS = [
  'mountain lake',
  'city lights',
  'coffee',
  'forest path',
  'desk plants',
  'ocean waves',
];

/** An allowed HTTPS address, or null: anything else is never fetched. */
export function allowedUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** GET an allowed address, following no redirect: a library cannot send us elsewhere. */
export async function fetchAllowed(
  fetcher: Fetcher,
  raw: string,
  userAgent: string,
): Promise<Response> {
  const url = allowedUrl(raw);
  if (!url) throw new Error(`not an allowed address: ${raw}`);
  const response = await fetcher(url.toString(), {
    headers: { 'user-agent': userAgent, accept: 'application/json, image/*' },
    redirect: 'manual',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status >= 300 && response.status < 400) {
    const next = response.headers.get('location');
    // One hop, and only to another allowed host (NASA's assets do this).
    if (!next || !allowedUrl(new URL(next, url).toString()))
      throw new Error('redirected elsewhere');
    return fetcher(new URL(next, url).toString(), {
      headers: { 'user-agent': userAgent },
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  }
  return response;
}

/** The picture's bytes, if it is an image under the size limit. */
export async function fetchPicture(fetcher: Fetcher, picture: Picture, userAgent: string) {
  const response = await fetchAllowed(fetcher, picture.imageUrl, userAgent);
  if (!response.ok) throw new Error(`picture: HTTP ${response.status}`);
  if (!(response.headers.get('content-type') ?? '').startsWith('image/')) {
    throw new Error('picture: not an image');
  }
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_PICTURE_BYTES) throw new Error('picture: too large');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PICTURE_BYTES) throw new Error('picture: too large');
  return bytes;
}

const pick = <T>(list: readonly T[], day: number): T | undefined => list[day % list.length];

/** Licences allowed, as Wikimedia writes them; anything else is passed over. */
const WIKIMEDIA_LICENCES = /^(public domain|cc0( 1\.0)?|cc by(-sa)? [0-9.]+)$/i;

const nasaListing = z.object({
  collection: z.object({
    items: z.array(
      z.object({
        data: z
          .array(
            z.object({
              title: z.string(),
              nasa_id: z.string(),
              center: z.string().optional(),
              photographer: z.string().optional(),
              description: z.string().optional(),
            }),
          )
          .min(1),
        links: z.array(z.object({ href: z.string(), rel: z.string().optional() })).optional(),
      }),
    ),
  }),
});

/** NASA's library: public domain, except work NASA did not make, which is skipped. */
export async function fromNasa(
  fetcher: Fetcher,
  day: number,
  userAgent: string,
): Promise<Picture | null> {
  const term = pick(NASA_TERMS, day)!;
  const url = `https://images-api.nasa.gov/search?q=${encodeURIComponent(term)}&media_type=image&page_size=40`;
  const response = await fetchAllowed(fetcher, url, userAgent);
  if (!response.ok) return null;
  const parsed = nasaListing.safeParse(await response.json());
  if (!parsed.success) return null;
  const usable = parsed.data.collection.items.filter((item) => {
    const data = item.data[0]!;
    const text = `${data.description ?? ''} ${data.photographer ?? ''}`;
    // Third-party work in NASA's library carries its own copyright.
    return !/copyright|©|courtesy of/i.test(text) && item.links?.[0]?.href;
  });
  const item = pick(usable, day);
  if (!item) return null;
  const data = item.data[0]!;
  return {
    source: 'NASA',
    title: data.title.slice(0, 140),
    creator: data.photographer ?? `NASA${data.center ? ` ${data.center}` : ''}`,
    licence: 'Public domain',
    freeToChange: true,
    landingUrl: `https://images.nasa.gov/details/${encodeURIComponent(data.nasa_id)}`,
    imageUrl: item.links![0]!.href.replace('~thumb.', '~medium.'),
  };
}

const wikimediaFeatured = z.object({
  image: z
    .object({
      title: z.string(),
      thumbnail: z.object({ source: z.string() }),
      artist: z.object({ text: z.string() }).optional(),
      license: z.object({ type: z.string() }),
      file_page: z.string(),
    })
    .optional(),
});

/** Wikimedia Commons' picture of the day, through Wikipedia's featured feed. */
export async function fromWikimedia(
  fetcher: Fetcher,
  date: Date,
  userAgent: string,
): Promise<Picture | null> {
  const ymd = date.toISOString().slice(0, 10).replaceAll('-', '/');
  const response = await fetchAllowed(
    fetcher,
    `https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${ymd}`,
    userAgent,
  );
  if (!response.ok) return null;
  const parsed = wikimediaFeatured.safeParse(await response.json());
  const image = parsed.success ? parsed.data.image : undefined;
  if (!image || !WIKIMEDIA_LICENCES.test(image.license.type.trim())) return null;
  const licence = image.license.type.trim();
  return {
    source: 'Wikimedia Commons',
    title: image.title
      .replace(/^File:/, '')
      .replace(/\.[a-z]+$/i, '')
      .slice(0, 140),
    creator: (image.artist?.text ?? 'Unknown').replace(/\s+/g, ' ').trim().slice(0, 80),
    licence,
    freeToChange: /^(public domain|cc0)/i.test(licence),
    landingUrl: image.file_page,
    imageUrl: image.thumbnail.source,
  };
}

const openverseListing = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      title: z.string().nullable().optional(),
      creator: z.string().nullable().optional(),
      license: z.string(),
      license_version: z.string().nullable().optional(),
      foreign_landing_url: z.string(),
      mature: z.boolean().optional(),
    }),
  ),
});

const OPENVERSE_ALLOWED = new Set(['cc0', 'pdm', 'by', 'by-sa']);

/** Openverse: openly licensed pictures from many collections, mature ones excluded. */
export async function fromOpenverse(
  fetcher: Fetcher,
  day: number,
  userAgent: string,
): Promise<Picture | null> {
  const term = pick(OPENVERSE_TERMS, day)!;
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(term)}&license=cc0,pdm,by,by-sa&mature=false&page_size=20`;
  const response = await fetchAllowed(fetcher, url, userAgent);
  if (!response.ok) return null;
  const parsed = openverseListing.safeParse(await response.json());
  if (!parsed.success) return null;
  const usable = parsed.data.results.filter(
    (item) => OPENVERSE_ALLOWED.has(item.license) && item.mature !== true,
  );
  const item = pick(usable, day);
  if (!item) return null;
  const name =
    item.license === 'pdm'
      ? 'Public domain'
      : item.license === 'cc0'
        ? 'CC0'
        : `CC ${item.license.toUpperCase()}`;
  return {
    source: 'Openverse',
    title: (item.title ?? 'Untitled').slice(0, 140),
    creator: (item.creator ?? 'Unknown').slice(0, 80),
    licence: `${name}${item.license_version && name.startsWith('CC ') ? ` ${item.license_version}` : ''}`,
    freeToChange: item.license === 'cc0' || item.license === 'pdm',
    landingUrl: item.foreign_landing_url,
    // Openverse's own thumbnail, so the bytes come from an allowed host.
    imageUrl: `https://api.openverse.org/v1/images/${encodeURIComponent(item.id)}/thumb/`,
  };
}
