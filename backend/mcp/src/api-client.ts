import {
  type BodyOf,
  type Contract,
  type ContractName,
  contracts,
  pathFor,
  type ResponseOf,
} from '@robis/shared';
import { currentTraceparent } from '@robis/telemetry';

/** The active trace for the API to continue, when there is one. */
function traceHeader(): Record<string, string> {
  const traceparent = currentTraceparent();
  return traceparent ? { traceparent } : {};
}

/**
 * The API, called as the agent (B5).
 *
 * The MCP server holds no authority of its own: every call carries the
 * caller's own token, so the API's permission matrix, idempotency ledger
 * and audit trail decide and record everything, exactly as for a request
 * sent to the API directly. A refusal comes back with the API's own status
 * and code, so an agent is told no in the same words a person would be.
 */

export class ApiRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Call<C extends Contract> = {
  /** The tool making the call, so the API can record which (B6). */
  tool: string;
  params: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  body?: BodyOf<C>;
  idempotencyKey?: string;
};

/** How long one API call may take before the tool reports it as failed. */
const CALL_TIMEOUT_MS = 10_000;

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
    /** The run id the caller sent, passed on so its calls are grouped as one run. */
    private readonly runKey: string | null = null,
  ) {}

  async call<N extends ContractName>(
    name: N,
    input: Call<(typeof contracts)[N]>,
  ): Promise<ResponseOf<(typeof contracts)[N]>> {
    const route = contracts[name] as Contract;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (value !== undefined) search.set(key, String(value));
    }
    const suffix = search.size > 0 ? `?${search}` : '';
    const response = await this.fetcher(
      `${this.baseUrl}${pathFor(route.path, input.params)}${suffix}`,
      {
        method: route.method,
        headers: {
          authorization: `Bearer ${this.token}`,
          'x-robis-tool': input.tool,
          ...(this.runKey ? { 'x-robis-run': this.runKey } : {}),
          ...(input.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(input.idempotencyKey ? { 'idempotency-key': input.idempotencyKey } : {}),
          // The tool call's trace, which the API's request span continues (A5).
          ...traceHeader(),
        },
        body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      },
    );

    const payload: unknown =
      response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const { error, message } = (payload ?? {}) as { error?: string; message?: string };
      throw new ApiRefusal(
        response.status,
        error ?? 'error',
        message ?? `The API answered ${response.status}`,
      );
    }
    // The answer is checked against the contract rather than trusted.
    return (route.response ? route.response.parse(payload) : payload) as ResponseOf<
      (typeof contracts)[N]
    >;
  }
}
