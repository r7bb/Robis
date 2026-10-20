/**
 * Smoke test against a running stack: `bun run smoke:stack`.
 *
 * Drives the containers the way a new person would, over their published
 * ports: sign up, confirm the address from the email the worker actually
 * sent, choose a picture, make a workspace and an issue, watch the issue
 * arrive over the WebSocket, and attach an image that lands in object
 * storage. Exits non-zero, saying which step failed, on the first problem.
 *
 * Defaults match deploy/compose.yaml; each can be overridden.
 */

import { TERMS_VERSION } from '@robis/shared';

const API = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:4000';
const REALTIME = process.env.SMOKE_REALTIME_URL ?? 'ws://127.0.0.1:4001/ws';
// The sink checks Host, and accepts 127.0.0.1 as readily as localhost.
const MAIL = process.env.SMOKE_MAIL_URL ?? 'http://127.0.0.1:8025';
const WEB_PORT = process.env.STACK_WEB_PORT ?? 3000;
// Addresses rather than names, so nothing depends on how `localhost`
// resolves; the Origin sent to the gateway is what a browser would send.
const WEB = process.env.SMOKE_WEB_URL ?? `http://127.0.0.1:${WEB_PORT}`;
const WEB_ORIGIN = process.env.SMOKE_WEB_ORIGIN ?? `http://localhost:${WEB_PORT}`;

/** Mail is sent by the worker from a queue it polls every second. */
const MAIL_WAIT_MS = 30_000;
const EVENT_WAIT_MS = 15_000;
const POLL_MS = 500;

/** A 1×1 PNG, the smallest image the attachment route will accept. */
const PIXEL_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  ),
  (char) => char.charCodeAt(0),
);

class SmokeFailure extends Error {}

function fail(step: string, detail: string): never {
  throw new SmokeFailure(`${step}: ${detail}`);
}

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await run();
  process.stdout.write(`  ok  ${name} (${Math.round(performance.now() - started)} ms)\n`);
  return result;
}

let cookie = '';

async function api(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const isBytes = body instanceof Uint8Array;
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined && !isBytes ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isBytes ? body : JSON.stringify(body),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0]!;
  return response;
}

async function expectStatus(name: string, response: Response, status: number) {
  if (response.status !== status) {
    fail(name, `expected ${status}, got ${response.status}: ${await response.text()}`);
  }
  return response;
}

async function until<T>(name: string, waitMs: number, probe: () => Promise<T | undefined>) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const found = await probe();
    if (found !== undefined) return found;
    await Bun.sleep(POLL_MS);
  }
  return fail(name, `nothing after ${waitMs} ms`);
}

/** A socket subscribed to one workspace, collecting what the gateway sends. */
async function subscribe(workspaceId: string) {
  const messages: { type: string; event?: { type: string; issueId?: string } }[] = [];
  const socket = new WebSocket(REALTIME, {
    // The gateway checks Origin as a browser would send it.
    headers: { cookie, origin: WEB_ORIGIN },
  } as unknown as string[]);
  socket.addEventListener('message', (message) => messages.push(JSON.parse(String(message.data))));

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new SmokeFailure('websocket: did not open')), {
      once: true,
    });
  });
  socket.send(JSON.stringify({ type: 'subscribe', workspaceId }));
  await until('websocket: ready', EVENT_WAIT_MS, async () =>
    messages.some((m) => m.type === 'ready')
      ? true
      : messages.find((m) => m.type === 'error')
        ? fail('websocket: subscribe', JSON.stringify(messages.at(-1)))
        : undefined,
  );
  return { socket, messages };
}

async function main() {
  const run = Date.now().toString(36);
  const email = `smoke-${run}@robis.test`;

  process.stdout.write(`Smoke test against ${API}\n`);

  await step('web app answers', async () => {
    const response = await fetch(WEB);
    await expectStatus('web', response, 200);
  });

  await step('sign up', async () => {
    const response = await api('POST', '/auth/register', {
      email,
      name: 'Smoke Test',
      username: `smoke_${run}`,
      password: `smoke-password-${run}`,
      ageConfirmed: true,
      // As the sign-up form does: the terms it showed, so the account
      // counts as having agreed and can open a workspace.
      termsVersion: TERMS_VERSION,
    });
    await expectStatus('sign up', response, 201);
    if (!cookie) fail('sign up', 'no session cookie');
  });

  await step('confirm the address from the email', async () => {
    const text = await until('verification email', MAIL_WAIT_MS, async () => {
      const { messages } = (await (await fetch(`${MAIL}/messages`)).json()) as {
        messages: { to: string[]; text: string }[];
      };
      return messages.find((m) => m.to.includes(email))?.text;
    });
    const link = /https?:\/\/\S+verify-email\?token=\S+/.exec(text)?.[0];
    if (!link) fail('verification email', `no link in:\n${text}`);
    const token = new URL(link).searchParams.get('token');

    await expectStatus('verify', await api('POST', '/auth/email/verify', { token }), 200);
    const me = (await (await api('GET', '/auth/me')).json()) as {
      user: { emailVerified: boolean };
    };
    if (!me.user.emailVerified) fail('verify', 'the account still reads as unverified');
  });

  await step('choose a picture', async () => {
    const response = await api('PUT', '/auth/me/avatar/generated', { seed: `smoke-${run}` });
    await expectStatus('picture', response, 200);
  });

  const workspaceId = await step('create a workspace', async () => {
    const response = await api('POST', '/workspaces', { name: 'Smoke', slug: `smoke-${run}` });
    await expectStatus('workspace', response, 201);
    return ((await response.json()) as { workspace: { id: string } }).workspace.id;
  });

  const live = await step('subscribe over the WebSocket', () => subscribe(workspaceId));

  const issueId = await step('create an issue and see it arrive live', async () => {
    const project = await api('POST', `/workspaces/${workspaceId}/projects`, { name: 'Smoke' });
    await expectStatus('project', project, 201);
    const projectId = ((await project.json()) as { project: { id: string } }).project.id;

    const created = await api('POST', `/workspaces/${workspaceId}/projects/${projectId}/issues`, {
      title: 'The stack starts from its images',
    });
    await expectStatus('issue', created, 201);
    const id = ((await created.json()) as { issue: { id: string } }).issue.id;

    await until('issue.created over the WebSocket', EVENT_WAIT_MS, async () =>
      live.messages.some((m) => m.event?.type === 'issue.created' && m.event.issueId === id)
        ? true
        : undefined,
    );
    return id;
  });
  live.socket.close();

  await step('attach an image, stored in S3', async () => {
    const uploaded = await api(
      'POST',
      `/workspaces/${workspaceId}/issues/${issueId}/attachments`,
      PIXEL_PNG,
      { 'content-type': 'image/png' },
    );
    await expectStatus('upload', uploaded, 201);
    const { attachment } = (await uploaded.json()) as { attachment: { url: string } };

    const fetched = await api('GET', attachment.url);
    await expectStatus('download', fetched, 200);
    if (fetched.headers.get('content-type') !== 'image/png') {
      fail('download', `content-type ${fetched.headers.get('content-type')}`);
    }
    if ((await fetched.arrayBuffer()).byteLength === 0) fail('download', 'empty body');
  });

  process.stdout.write('Smoke test passed.\n');
}

try {
  await main();
} catch (error) {
  process.stderr.write(`Smoke test failed. ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}
