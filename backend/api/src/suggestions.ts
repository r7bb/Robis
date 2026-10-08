/**
 * Client for the duplicate-detection service.
 *
 * Suggestions are a nicety. Filing an issue is the job. So every failure
 * here -- unconfigured, unreachable, slow, returning nonsense -- resolves
 * to "no suggestions" rather than propagating, and the composer renders
 * exactly as it does when the service was never deployed.
 *
 * This is the whole reason it is a separate port on a separate process: a
 * Python service that is down must not be able to stop anybody writing
 * down a bug.
 */

import type { FastifyBaseLogger } from 'fastify';

/** One candidate duplicate, as the UI shows it. */
export type SimilarIssue = {
  id: string;
  title: string;
  /** Cosine similarity, 0 to 1. Returned so the caller can set its own bar. */
  score: number;
};

export type SuggestionClient = {
  similar(workspaceId: string, title: string, description?: string | null): Promise<SimilarIssue[]>;
};

export type SuggestionConfig = {
  /** Base URL of the ML service. Absent means the feature is off. */
  url: string | null;
  /** Shared bearer token. The service refuses to start without one. */
  token: string | null;
  /**
   * How long to wait before giving up.
   *
   * Short on purpose. This sits between a keystroke and a hint, so a
   * suggestion that arrives after a second is worse than none: the writer
   * has moved on and the UI jumps under them.
   */
  timeoutMs: number;
};

/** The feature switched off. Used when no URL is configured, and in tests. */
export const noSuggestions: SuggestionClient = {
  async similar() {
    return [];
  },
};

/**
 * Only matches this confident are worth interrupting somebody with.
 *
 * Tuned against the seeded corpus by eye, and deliberately stricter than
 * the service's own default: a false "this already exists" costs more
 * attention than a missed duplicate costs duplication.
 */
const MIN_SCORE = 0.35;

/** Never show more than this, however many clear the bar. */
const MAX_SUGGESTIONS = 3;

type ServiceResponse = {
  similar?: { id?: unknown; title?: unknown; score?: unknown }[];
};

/** Nothing from across a network boundary is trusted into the response. */
function parse(payload: unknown): SimilarIssue[] {
  const body = payload as ServiceResponse;
  if (!Array.isArray(body?.similar)) return [];

  const rows: SimilarIssue[] = [];

  for (const row of body.similar) {
    if (typeof row?.id !== 'string' || typeof row?.title !== 'string') continue;
    if (typeof row?.score !== 'number' || !Number.isFinite(row.score)) continue;
    if (row.score < MIN_SCORE) continue;

    rows.push({ id: row.id, title: row.title, score: row.score });
  }

  return rows.slice(0, MAX_SUGGESTIONS);
}

export function createSuggestionClient(
  config: SuggestionConfig,
  log: FastifyBaseLogger,
): SuggestionClient {
  if (!config.url) return noSuggestions;

  const base = config.url.replace(/\/$/, '');

  return {
    async similar(workspaceId, title, description) {
      // `AbortSignal.timeout` rather than a racing promise, so the socket is
      // actually closed when the deadline passes instead of being left to
      // finish into nothing.
      const signal = AbortSignal.timeout(config.timeoutMs);

      try {
        const response = await fetch(`${base}/workspaces/${workspaceId}/similar`, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
          },
          body: JSON.stringify({ title, description: description ?? null }),
        });

        if (!response.ok) {
          log.warn({ status: response.status }, 'suggestion service returned an error');
          return [];
        }

        return parse(await response.json());
      } catch (error) {
        // Logged once at warn, never surfaced. A composer that reports
        // "could not reach the suggestion service" is worse than one that
        // quietly has no suggestions.
        log.warn({ err: error }, 'suggestion service unreachable');
        return [];
      }
    },
  };
}
