import { type Contract, type HandlerResult, type InputOf, statusesOf } from '@robis/shared';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
  RouteShorthandOptions,
} from 'fastify';
import { parse } from './validate.ts';

type Options = Omit<RouteShorthandOptions, 'preHandler'> & {
  preHandler?: preHandlerHookHandler | preHandlerHookHandler[];
};

type Handler<C extends Contract> = (
  request: FastifyRequest,
  input: InputOf<C>,
  reply: FastifyReply,
) => Promise<HandlerResult<C> | FastifyReply>;

/**
 * Register a route from its contract (stage 2, item 20).
 *
 * The handler gets its params, query and body already parsed (a 400 naming
 * the fields otherwise), after the route's hooks have checked who is asking.
 * What it returns goes out through the response schema: a field the
 * contract does not name is dropped rather than sent, and a shape the
 * contract does not allow is a server error, caught by the tests.
 */
export function serve<C extends Contract>(
  app: FastifyInstance,
  route: C,
  options: Options,
  handler: Handler<C>,
) {
  app.route({
    ...options,
    method: route.method,
    url: route.path,
    handler: async (request, reply) => {
      const input = {
        params: route.params ? parse(route.params, request.params) : undefined,
        query: route.query ? parse(route.query, request.query) : undefined,
        body: route.body ? parse(route.body, request.body ?? {}) : undefined,
      } as InputOf<C>;
      const result = await handler(request, input, reply);
      // Answered already: by the idempotency ledger, through `shape`.
      if (reply.sent) return reply;
      const [status] = statusesOf(route);
      if (route.response === null) return reply.status(status ?? 204).send();
      return reply.status(status ?? 200).send(route.response.parse(result));
    },
  });
}

/**
 * A value put through the route's response schema, for a handler that sends
 * its own reply (the idempotency ledger stores and replays what it is
 * given): what it stores is then exactly what the contract allows.
 */
export function shape<C extends Contract>(route: C, value: HandlerResult<C>): unknown {
  return route.response ? route.response.parse(value) : value;
}
