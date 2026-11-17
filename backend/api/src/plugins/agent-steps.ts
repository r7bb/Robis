import { type Database, deferAgentStep, outcomeOf } from '@robis/database';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Every call an agent makes in its own workspace, recorded as a step of a
 * run once it has been answered (B6): the tool, the outcome, the status and
 * how long it took, never what was sent. A call refused because the token
 * names another workspace is not recorded there: that workspace's admins
 * should not see another workspace's agent. The MCP server's metrics count
 * those refusals instead.
 */

/** A tool name the MCP server sends; anything else is named by its route. */
const TOOL = /^[a-z_]{1,40}$/;
/** A run id a caller sent, passed on by the MCP server. */
const RUN_KEY = /^[A-Za-z0-9_.:-]{1,100}$/;

const header = (request: FastifyRequest, name: string) => {
  const value = request.headers[name];
  return typeof value === 'string' ? value : null;
};

export function recordAgentSteps(db: Database) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { user, agentToken, resolvedRole } = request;
    if (user?.kind !== 'agent' || !agentToken || !resolvedRole?.role) return;

    const tool = header(request, 'x-robis-tool');
    const sentRun = header(request, 'x-robis-run');
    deferAgentStep(
      db,
      {
        workspaceId: resolvedRole.workspaceId,
        agentId: user.id,
        // A token made for one run is that run; otherwise the caller's own id, if any.
        runKey: agentToken.perRun
          ? `token:${agentToken.id}`
          : // Prefixed, so a caller's id can never pass for a run token's.
            sentRun && RUN_KEY.test(sentRun)
            ? `run:${sentRun}`
            : null,
        source: agentToken.perRun ? 'triage' : 'calls',
        tool: tool && TOOL.test(tool) ? tool : `api:${request.routeOptions.url ?? 'unknown'}`,
        outcome: outcomeOf(reply.statusCode),
        status: reply.statusCode,
        durationMs: reply.elapsedTime,
      },
      // Watching must never break the work it watches.
      (error) => request.log.warn({ err: error }, 'could not record an agent step'),
    );
  };
}
