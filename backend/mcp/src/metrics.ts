import { Registry } from '@robis/metrics';
import { TOOL_NAMES, type ToolName, type ToolOutcome } from './tools.ts';

/**
 * The MCP server's metrics (B6): how long each tool takes, and how often it
 * succeeds, is refused or fails. Labelled only from fixed lists, the tool
 * names and three outcomes, so no caller can mint a new series; nothing
 * names a workspace or an agent, which a metrics endpoint has no business
 * exposing.
 */

const OUTCOMES: readonly ToolOutcome[] = ['ok', 'denied', 'error'];
/** Tool calls are API calls: milliseconds to a few seconds. */
const BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export function toolMetrics() {
  const registry = new Registry();
  const calls = registry.counter(
    'robis_mcp_tool_calls_total',
    'Tool calls by tool and outcome (ok, denied, error).',
    ['tool', 'outcome'],
  );
  const latency = registry.histogram(
    'robis_mcp_tool_duration_seconds',
    'How long each tool call took, by tool.',
    ['tool'],
    BUCKETS_SECONDS,
  );
  // Every series exists from the start, so a rate over a quiet tool is 0, not missing.
  for (const tool of TOOL_NAMES) for (const outcome of OUTCOMES) calls.inc({ tool, outcome }, 0);

  return {
    registry,
    observe(tool: ToolName, outcome: ToolOutcome, ms: number) {
      if (!TOOL_NAMES.includes(tool) || !OUTCOMES.includes(outcome)) return;
      calls.inc({ tool, outcome });
      latency.observe({ tool }, ms / 1000);
    },
  };
}
