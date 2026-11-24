/**
 * Service worker: makes the app shell available with no network.
 *
 * Without this, "offline-first" was only half true. The board's *data* lives in
 * IndexedDB and survives a disconnection, but a cold page load still fetched
 * HTML and JavaScript from the dev server, so reloading while offline showed
 * the browser's error page and none of that data was reachable.
 *
 * Two strategies, chosen per request type:
 *
 * - **Navigations** are network-first with a cached fallback. The app changes
 *   between deploys, so a stale shell is worse than a slow one -- but a stale
 *   shell is far better than no page at all.
 * - **Static assets** are cache-first. Next.js fingerprints these filenames, so
 *   a given URL's contents never change and revalidating is wasted latency.
 *
 * API and WebSocket traffic is deliberately *not* cached. Those responses are
 * authorization-dependent and change constantly; serving a stale one could show
 * a user data they no longer have access to. The sync engine already owns
 * offline data.
 */

/*
 * Bump this to evict a worker serving a stale build.
 *
 * It is the only escape hatch for a browser already stuck, and the reason
 * matters. A registered worker serves the cached bundle, so a fix shipped
 * *inside* the application cannot reach a client that worker is holding:
 * the stale worker hands back the stale fix. That happened after a run
 * with `NEXT_PUBLIC_ENABLE_SW=1` left a worker in a development browser.
 *
 * The way out is this file. Browsers re-fetch the worker script on
 * navigation and byte-compare it, bypassing the worker's own cache. New
 * bytes mean install, `skipWaiting`, then the `activate` handler below
 * deletes every cache whose key does not start with the current VERSION
 * and claims open clients. That machinery already existed; it had simply
 * never run, because the version had never changed.
 */
const VERSION = 'robis-v4';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

/** Served when a navigation fails and nothing matching is cached. */
const OFFLINE_FALLBACK = '/offline.html';

/**
 * Things shared to Robis from another app (C8), waiting for the share page
 * to turn them into an issue. Not versioned, so a new worker does not throw
 * away a photo shared a moment before it took over.
 */
const SHARE_CACHE = 'robis-share';
const SHARE_PATH = '/share';
/** At most this many pictures from one share, each at most 8 MB, as uploads are. */
const SHARE_FILES_MAX = 4;
const SHARE_FILE_BYTES = 8 * 1024 * 1024;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([OFFLINE_FALLBACK]))
      // Replace the previous worker immediately rather than waiting for every
      // tab to close.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(VERSION) && key !== SHARE_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** True for requests that must never be served from cache. */
function isDynamic(url) {
  return (
    url.pathname.startsWith('/api/') ||
    // The API and gateway are separate origins in development.
    url.port === '4000' ||
    url.port === '4001'
  );
}

/**
 * Pages whose URL carries a single-use token; the same list as
 * TOKEN_PAGES in next.config.ts. Matched by path, not by `no-store`:
 * every page is rendered per request now and sends `no-store`, and the rest
 * must still be kept for offline use.
 */
const TOKEN_PAGES = ['/reset-password', '/verify-email', '/signup'];

function isTokenPage(url) {
  return TOKEN_PAGES.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`));
}

function isStaticAsset(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/static/');
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetch(request);
    // Only cache successful, complete responses; a 404 or a redirect would be
    // a bad thing to replay offline. Nor a page whose URL carries a one-time
    // link: the Cache API ignores the `no-store` those pages send.
    if (response.ok && !isTokenPage(new URL(request.url))) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? (await cache.match(OFFLINE_FALLBACK));
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);

  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

/**
 * A share from another app (C8): the phone posts the photo, link or words
 * here. Kept in the share cache, with or without a network, and then the
 * share page opens to say which board they go on.
 */
async function receiveShare(request) {
  const form = await request.formData();
  const cache = await caches.open(SHARE_CACHE);
  for (const key of await cache.keys()) await cache.delete(key);
  const files = form
    .getAll('files')
    .filter((file) => typeof file === 'object' && file.type.startsWith('image/'))
    .filter((file) => file.size <= SHARE_FILE_BYTES)
    .slice(0, SHARE_FILES_MAX);
  const text = (name) => String(form.get(name) ?? '').slice(0, 2000);
  await cache.put(
    `${SHARE_PATH}/inbox/meta`,
    Response.json({
      title: text('title'),
      text: text('text'),
      url: text('url'),
      files: files.length,
    }),
  );
  for (const [index, file] of files.entries()) {
    await cache.put(
      `${SHARE_PATH}/inbox/file-${index}`,
      new Response(file, { headers: { 'content-type': file.type } }),
    );
  }
  return Response.redirect(SHARE_PATH, 303);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method === 'POST' && new URL(request.url).pathname === SHARE_PATH) {
    event.respondWith(receiveShare(request));
    return;
  }

  // Only GET is cacheable; a mutation must always reach the server or fail
  // loudly so the sync queue can retry it.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isDynamic(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});

/*
 * Web push (C3).
 *
 * A push carries nothing: the server sends no title, no text and no ids,
 * the same rule its realtime events follow, so there is nothing here to
 * read or to leak from a lock screen. Every push shows the same prompt,
 * and the app says what is new once it is open. One tag, so a second
 * prompt replaces the first rather than stacking up.
 */
self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('Robis', {
      body: 'Something new is waiting for you. Open Robis to see it.',
      tag: 'robis',
      // Replacing the last prompt still tells you, rather than changing it silently.
      renotify: true,
    }),
  );
});

/** Tapping the prompt brings an open Robis forward, or opens one. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      return open ? open.focus() : self.clients.openWindow('/workspaces');
    }),
  );
});
