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

/** The priorities the model can actually predict. `NONE` is "untriaged", not a class. */
const PREDICTABLE = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
type PredictedPriority = (typeof PREDICTABLE)[number];

/** One candidate duplicate, as the UI shows it. */
export type SimilarIssue = {
  id: string;
  title: string;
  /** Cosine similarity, 0 to 1. Returned so the caller can set its own bar. */
  score: number;
};

/**
 * A priority the composer can offer, or the reason it cannot.
 *
 * The refusal is a real answer, not an absence: below its training minimum
 * the model declines rather than returning a confident-looking guess, and
 * the composer says so with the counts. `null` from the client is the
 * different case where there is nothing to say at all: the service is off,
 * down, slow or answered with something unusable.
 */
export type TriageSuggestion =
  | { priority: PredictedPriority; score: number }
  | { priority: null; trainedOn: number; needed: number };

export type SuggestionClient = {
  similar(workspaceId: string, title: string, description?: string | null): Promise<SimilarIssue[]>;
  triage(
    workspaceId: string,
    title: string,
    description?: string | null,
  ): Promise<TriageSuggestion | null>;
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
  async triage() {
    return null;
  },
};

/**
 * A floor under the service's own threshold, in case it is ever run with a
 * looser one.
 *
 * The service's default (0.40, chosen by `robis-ml`'s duplicate evaluation)
 * already sits above this, so at the default it filters nothing. A test in
 * `robis-ml` reads this constant and fails if it ever rises above that
 * default, because then this would be quietly dropping hints the
 * evaluation counts as shown.
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

type TriagePayload = {
  priority?: unknown;
  score?: unknown;
  trained_on?: unknown;
  needed?: unknown;
};

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * The service's triage answer, checked field by field.
 *
 * Anything unexpected becomes `null` (show nothing) rather than reaching
 * the composer: a priority outside the four the model predicts, a score
 * that is not a probability, or a refusal without the counts that make it
 * worth showing.
 */
export function parseTriage(payload: unknown): TriageSuggestion | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const body = payload as TriagePayload;

  if (body.priority === null) {
    if (!isCount(body.trained_on) || !isCount(body.needed)) return null;
    return { priority: null, trainedOn: body.trained_on, needed: body.needed };
  }

  if (!PREDICTABLE.includes(body.priority as PredictedPriority)) return null;
  if (typeof body.score !== 'number' || !Number.isFinite(body.score)) return null;
  if (body.score < 0 || body.score > 1) return null;

  return { priority: body.priority as PredictedPriority, score: body.score };
}

export function createSuggestionClient(
  config: SuggestionConfig,
  log: FastifyBaseLogger,
): SuggestionClient {
  if (!config.url) return noSuggestions;

  const base = config.url.replace(/\/$/, '');

  /** The service's JSON for one endpoint, or `undefined` on any failure. */
  async function ask(
    workspaceId: string,
    endpoint: 'similar' | 'triage',
    title: string,
    description?: string | null,
  ): Promise<unknown> {
    // `AbortSignal.timeout` rather than a racing promise, so the socket is
    // actually closed when the deadline passes instead of being left to
    // finish into nothing.
    const signal = AbortSignal.timeout(config.timeoutMs);

    try {
      const response = await fetch(`${base}/workspaces/${workspaceId}/${endpoint}`, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
        },
        body: JSON.stringify({ title, description: description ?? null }),
      });

      if (!response.ok) {
        log.warn({ status: response.status, endpoint }, 'suggestion service returned an error');
        return undefined;
      }

      return await response.json();
    } catch (error) {
      // Logged once at warn, never surfaced. A composer that reports
      // "could not reach the suggestion service" is worse than one that
      // quietly has no suggestions.
      log.warn({ err: error, endpoint }, 'suggestion service unreachable');
      return undefined;
    }
  }

  return {
    async similar(workspaceId, title, description) {
      return parse(await ask(workspaceId, 'similar', title, description));
    },
    async triage(workspaceId, title, description) {
      return parseTriage(await ask(workspaceId, 'triage', title, description));
    },
  };
}
