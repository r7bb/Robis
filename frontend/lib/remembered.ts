import { ApiError } from './api.ts';
import { getSyncEngine } from './sync.ts';

/**
 * A read that also works offline (C8): each answer is kept on the device,
 * and when the network is out (the request never got an answer) the last
 * one kept is shown instead, as it is when the server itself fails (5xx)
 * or asks to wait (408, 429). A real refusal, a 403 or a 404, is never
 * papered over with an old copy. Kept answers go on sign-out.
 */
export function remembered<T>(key: string, fetcher: () => Promise<T>): () => Promise<T> {
  return async () => {
    const engine = getSyncEngine();
    const since = engine.currentEpoch();
    try {
      const value = await fetcher();
      // Who is signed in decides whose device this is, whichever form they came in by.
      const user = (value as { user?: { id?: unknown } } | null)?.user;
      if (key === 'me' && typeof user?.id === 'string') {
        await engine.claimFor(user.id).catch(() => undefined);
      }
      void engine.remember(key, value, since).catch(() => undefined);
      return value;
    } catch (error) {
      // A real refusal stands; the server failing or asking for patience
      // is treated like no network.
      if (
        error instanceof ApiError &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 429
      ) {
        throw error;
      }
      const kept = await engine.recall<T>(key).catch(() => undefined);
      if (kept !== undefined) return kept;
      throw error;
    }
  };
}
