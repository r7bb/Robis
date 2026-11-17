import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { agentRuns, agentSteps, suggestionFeedback } from '@robis/database';
import { toolMetrics } from '@robis/mcp/metrics.ts';
import { TOOL_NAMES } from '@robis/mcp/tools.ts';
import {
  closeHarness,
  createActor,
  createWorkspace,
  getHarness,
  refusal,
  resetDatabase,
} from './harness.ts';

/**
 * Watching agents (B6, slice 1): the MCP server's metrics, labelled only
 * from fixed lists, and the tables that hold runs, steps and hint feedback.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

describe('the MCP server’s metrics', () => {
  test('count calls by tool and outcome, and time them, from fixed lists only', () => {
    const metrics = toolMetrics();
    metrics.observe('comment', 'ok', 42);
    metrics.observe('create_issue', 'denied', 7);
    metrics.observe('not_a_tool' as never, 'ok', 1);

    const text = metrics.registry.render();
    expect(text).toContain('robis_mcp_tool_calls_total{outcome="ok",tool="comment"} 1');
    expect(text).toContain('robis_mcp_tool_calls_total{outcome="denied",tool="create_issue"} 1');
    expect(text).toContain('robis_mcp_tool_duration_seconds_count{tool="comment"} 1');
    expect(text).not.toContain('not_a_tool');
  });

  test('every tool and outcome is a series from the start, at zero', () => {
    const text = toolMetrics().registry.render();
    for (const tool of TOOL_NAMES) {
      for (const outcome of ['ok', 'denied', 'error']) {
        expect(text).toContain(`robis_mcp_tool_calls_total{outcome="${outcome}",tool="${tool}"} 0`);
      }
    }
  });
});

describe('the tables', () => {
  test('a run’s steps go with it, and an outcome must be one of three', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const { ownerDb } = await getHarness();
    const [run] = await ownerDb
      .insert(agentRuns)
      .values({ workspaceId: workspace.id, agentId: owner.id, source: 'calls' })
      .returning();
    const step = {
      runId: run!.id,
      workspaceId: workspace.id,
      tool: 'comment',
      status: 201,
      durationMs: 12,
    };
    await ownerDb.insert(agentSteps).values({ ...step, outcome: 'ok' });
    expect(
      await refusal(ownerDb.insert(agentSteps).values({ ...step, outcome: 'fine' as never })),
    ).toContain('agent_step_outcome');
  });

  test('hint feedback names no person', () => {
    expect(Object.keys(suggestionFeedback)).not.toContain('userId');
  });
});
