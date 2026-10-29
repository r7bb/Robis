/**
 * Capture the README's moving pictures: `bun run capture:motion`.
 *
 * Like `screenshots.ts`, these come from the running app, not a mock-up:
 * it drives a real Chrome over CDP against the container stack
 * (`docker compose -f deploy/compose.yaml up -d --wait`), takes frames at a
 * steady interval and joins them into animated WebP with sharp, which the
 * API already depends on. Two clips:
 *
 *   imgs/motion-landing.webp   the landing page's hero
 *   imgs/02-workspaces.png      the signed-in home, still
 *   imgs/motion-home.webp      the signed-in home while a teammate opens an
 *                              issue in another session: the spark flies
 *                              to its workspace, the feed and tile update
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { findChrome, listTargets, Page, type Target } from './cdp.ts';

const WEB = process.env.SMOKE_WEB_URL ?? 'http://localhost:3000';
// Through the edge proxy: by address from this script, and the session
// cookie for the web app's own origin, where the API now lives.
const API = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3000/api';
const WEB_API = process.env.SMOKE_WEB_API_URL ?? WEB;
const SHOTS = new URL('../../imgs/', import.meta.url).pathname;
const PORT = 9493;
const WIDTH = 1280;
const HEIGHT = 760;
/** About twelve frames a second: smooth enough, small enough for a README. */
const FRAME_MS = 80;
const PASSWORD = process.env.SEED_PASSWORD ?? 'robis-demo-password';

type Frame = { data: Buffer; at: number };

async function capture(page: Page, count: number, during?: (index: number) => Promise<void>) {
  const frames: Frame[] = [];
  for (let i = 0; i < count; i++) {
    const began = performance.now();
    const { data } = await page.send<{ data: string }>('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 88,
    });
    frames.push({ data: Buffer.from(data, 'base64'), at: began });
    await during?.(i);
    const spent = performance.now() - began;
    if (spent < FRAME_MS) await Bun.sleep(FRAME_MS - spent);
  }
  return frames;
}

/** Join frames into a looping WebP, each shown for as long as it really lasted. */
async function save(name: string, frames: Frame[]) {
  const delays = frames.map((frame, i) =>
    Math.round((frames[i + 1]?.at ?? frame.at + FRAME_MS) - frame.at),
  );
  const image = await sharp(
    frames.map((f) => f.data),
    { join: { animated: true } },
  )
    .webp({ quality: 72, effort: 5, loop: 0, delay: delays })
    .toBuffer();
  await Bun.write(`${SHOTS}${name}`, image);
  process.stdout.write(
    `  ${name}: ${frames.length} frames, ${Math.round(image.length / 1024)} KB\n`,
  );
}

async function signIn(email: string) {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`sign-in as ${email}: ${response.status}`);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

async function asAlex(method: string, path: string, body?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: WEB, cookie: alexCookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.json() as Promise<Record<string, unknown>>;
}

let alexCookie = '';

async function main() {
  const chrome = Bun.spawn(
    [
      findChrome(),
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${join(tmpdir(), `robis-motion-${Date.now()}`)}`,
      '--host-resolver-rules=MAP localhost 127.0.0.1',
      '--hide-scrollbars',
      '--enable-unsafe-swiftshader',
      'about:blank',
    ],
    { stdout: 'ignore', stderr: 'ignore' },
  );
  try {
    let target: Target | undefined;
    for (let i = 0; i < 150 && !target; i++) {
      await Bun.sleep(200);
      target = await listTargets(PORT)
        .then((all) => all.find((t) => t.type === 'page'))
        .catch(() => undefined);
    }
    if (!target) throw new Error('Chrome did not start');
    const page = await Page.attach(target, {
      port: PORT,
      shotsDir: SHOTS,
      width: WIDTH,
      height: HEIGHT,
      scale: 1,
    });

    // The landing hero.
    await page.goto(`${WEB}/`);
    await Bun.sleep(2500);
    await save('motion-landing.webp', await capture(page, 44));

    // The home, signed in in the browser, while Alex works in another session.
    await page.goto(`${WEB}/login`);
    const cookie = await signIn('rohit@robis.test');
    const [name, value] = cookie.split('=');
    // For the address the web app calls the API at, so the browser sends it.
    await page.send('Network.setCookie', { name, value, url: WEB_API, httpOnly: true });
    alexCookie = await signIn('alex@robis.test');
    const workspaces = (await asAlex('GET', '/workspaces')).workspaces as {
      id: string;
      name: string;
    }[];
    const engineering = workspaces.find((w) => w.name === 'Engineering') ?? workspaces[0]!;
    const projects = (await asAlex('GET', `/workspaces/${engineering.id}/projects`)).projects as {
      id: string;
    }[];

    await page.goto(`${WEB}/workspaces`);
    await page.waitFor('document.body.textContent.includes("Connected")', 20_000);
    await Bun.sleep(1500);
    const frames = await capture(page, 52, async (i) => {
      if (i === 10) {
        await asAlex('POST', `/workspaces/${engineering.id}/projects/${projects[0]!.id}/issues`, {
          title: 'Polish the onboarding tour',
        });
      }
    });
    await save('motion-home.webp', frames);

    // And the home's still, at the size `screenshots.ts` takes every other
    // still, so it can be refreshed without the development servers.
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await page.goto(`${WEB}/workspaces`);
    await page.waitFor('document.body.textContent.includes("Connected")', 20_000);
    await Bun.sleep(1800);
    await page.shot('02-workspaces.png');
    page.close();
  } finally {
    chrome.kill();
  }
}

process.stdout.write(`Capturing motion against ${WEB}\n`);
await main();
