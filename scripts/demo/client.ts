/**
 * How demo:life reaches the stack: the API through the edge proxy, as a
 * person with a session cookie or as an agent with its token, and a live
 * socket per person that keeps them present while the runner runs.
 */

import { DEMO_PASSWORD } from '@robis/shared';
import type { ActorRole } from './plan.ts';

export type Stack = {
  /** The edge proxy, as this process reaches it. */
  web: string;
  /** The web app's origin, as a browser would send it: writes need it. */
  origin: string;
};

/** Someone who can act: a signed-in person or an agent holding a token. */
export type Actor = {
  name: string;
  role: ActorRole;
  userId: string;
  call: <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => Promise<T>;
};

export class RefusedError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function caller(stack: Stack, credentials: () => Record<string, string>) {
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${stack.web}/api${path}`, {
      method,
      headers: {
        origin: stack.origin,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...credentials(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new RefusedError(
        response.status,
        `${method} ${path}: ${response.status} ${await response.text()}`,
      );
    }
    return (response.status === 204 ? {} : await response.json()) as T;
  };
}

/** Sign a seeded person in with the demo password; their session, as an actor. */
export async function signIn(stack: Stack, email: string, name: string) {
  const response = await fetch(`${stack.web}/api/auth/login`, {
    method: 'POST',
    headers: { origin: stack.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(`sign-in for ${email}: ${response.status} ${await response.text()}`);
  }
  const cookies = response.headers.getSetCookie().map((line) => line.split(';')[0]!);
  const session = cookies.find((cookie) => cookie.includes('_session='));
  if (!session) throw new Error(`sign-in for ${email}: no session cookie`);
  const { user } = (await response.json()) as { user?: { id: string } };
  if (!user) throw new Error(`sign-in for ${email}: a second step was asked for`);
  const cookie = cookies.join('; ');
  return { name, userId: user.id, cookie, call: caller(stack, () => ({ cookie })) };
}

/** An agent acting with its token. */
export function asAgent(stack: Stack, name: string, userId: string, secret: string): Actor {
  return {
    name,
    role: 'AGENT',
    userId,
    call: caller(stack, () => ({ authorization: `Bearer ${secret}` })),
  };
}

const RECONNECT_MS = 5_000;
/** Well inside the gateway's 45-second presence lifetime, which a ping renews. */
const PING_MS = 20_000;

/**
 * Keep a person present: a socket subscribed to the workspace, opened again
 * whenever it drops, until `stop` is called. Presence is the gateway's own:
 * an open, subscribed socket is exactly what makes someone show as here.
 */
export function stayPresent(stack: Stack, cookie: string, workspaceId: string) {
  let stopped = false;
  let socket: WebSocket | null = null;
  const ping = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
  }, PING_MS);
  const open = () => {
    if (stopped) return;
    socket = new WebSocket(`${stack.web.replace(/^http/, 'ws')}/ws`, {
      headers: { cookie, origin: stack.origin },
    } as unknown as string[]);
    socket.addEventListener('open', () =>
      socket?.send(JSON.stringify({ type: 'subscribe', workspaceId })),
    );
    socket.addEventListener('close', () => {
      if (!stopped) setTimeout(open, RECONNECT_MS);
    });
    socket.addEventListener('error', () => socket?.close());
  };
  open();
  return () => {
    stopped = true;
    clearInterval(ping);
    socket?.close();
  };
}
