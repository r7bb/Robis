import { z } from 'zod';

/**
 * One HTTP route, described once (stage 2, item 20).
 *
 * The API registers its handler from this (`serve`), so the handler is typed
 * from it and what it returns is checked against it; the web app calls the
 * route from it (`call`), so its types come from the same place; and the
 * OpenAPI document is generated from it. A route's shape can no longer drift
 * between the three.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type Contract = {
  method: HttpMethod;
  /** Fastify's spelling: `/workspaces/:workspaceId`. */
  path: `/${string}`;
  /** One line, for the OpenAPI document. */
  summary: string;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  /**
   * For a route whose body is not JSON (image bytes, say): its content type.
   * The handler reads the body itself; the OpenAPI document shows it as binary.
   */
  rawBody?: string;
  /**
   * 200 unless said otherwise; 204 when there is no response body. A route
   * that answers with more than one success code lists them, first the one
   * it uses unless the handler says otherwise.
   */
  status?: number | readonly number[];
  /** What the route sends back, or null for an empty 204. */
  response: z.ZodType | null;
};

/** A contract, with its literal types kept for the callers. */
export function contract<const C extends Contract>(definition: C): C {
  return definition;
}

/**
 * A point in time. Handlers return the database's Date; JSON carries the ISO
 * string, which is what the web app receives (see `Wire`).
 */
export const timestamp = z.union([z.date(), z.iso.datetime({ offset: true })]);

/** What a value becomes once it has been through JSON: dates are strings. */
export type Wire<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

type Schema<C extends Contract, K extends 'params' | 'query' | 'body'> = C[K] extends z.ZodType
  ? C[K]
  : never;

/** What a handler may return for the route. */
export type HandlerResult<C extends Contract> = C['response'] extends z.ZodType
  ? z.input<C['response']>
  : undefined;

/** What a caller sends as the route's body. */
export type BodyOf<C extends Contract> = C['body'] extends z.ZodType ? z.input<C['body']> : never;

/** What the web app receives from the route. */
export type ResponseOf<C extends Contract> = C['response'] extends z.ZodType
  ? Wire<z.output<C['response']>>
  : undefined;

/** The parsed input a handler is given. */
export type InputOf<C extends Contract> = {
  params: C['params'] extends z.ZodType ? z.output<Schema<C, 'params'>> : undefined;
  query: C['query'] extends z.ZodType ? z.output<Schema<C, 'query'>> : undefined;
  body: C['body'] extends z.ZodType ? z.output<Schema<C, 'body'>> : undefined;
};

/** What a caller passes: only the parts the route has. */
export type CallInput<C extends Contract> = (C['params'] extends z.ZodType
  ? { params: z.input<Schema<C, 'params'>> }
  : { params?: never }) &
  (C['query'] extends z.ZodType ? { query?: z.input<Schema<C, 'query'>> } : { query?: never }) &
  (C['body'] extends z.ZodType ? { body: z.input<Schema<C, 'body'>> } : { body?: never });

/** The success codes a route answers with. */
export function statusesOf(route: Contract): readonly number[] {
  if (route.status === undefined) return [route.response ? 200 : 204];
  return typeof route.status === 'number' ? [route.status] : route.status;
}

/** The path with its `:name` segments filled in, each one encoded. */
export function pathFor(path: string, params: Record<string, unknown> = {}): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined || value === null || value === '') {
      throw new Error(`missing path parameter ${name} for ${path}`);
    }
    return encodeURIComponent(String(value));
  });
}
