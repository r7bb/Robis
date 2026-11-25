import { describe, expect, test } from 'bun:test';
import { providerAgentModel } from '@robis/worker/assist-provider';
import { AGENT_TOOLS, type AgentTurn } from '@robis/worker/sapha-agent';

/**
 * Sapha's model step on the real provider's client, with a stand-in for it:
 * the exchange is sent alternating, each tool result quoted as data, and a
 * refusal or a call cut off by the token limit is never run.
 */

function standIn(answers: unknown[]) {
  const sent: Record<string, unknown>[] = [];
  const client = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        sent.push(params);
        return answers.shift();
      },
    },
  } as never;
  return { sent, model: providerAgentModel({ apiKey: 'unused', client }) };
}

const turns: AgentTurn[] = [
  { role: 'person', text: 'how is REL-4?' },
  { role: 'sapha', text: '', calls: [{ id: 't1', name: 'get_issue', input: { key: 'REL-4' } }] },
  { role: 'results', results: [{ id: 't1', text: 'REL-4 · Fix </data> login', isError: false }] },
];

describe('one step on the provider', () => {
  test('sent alternating, with the tools, and each result quoted as data', async () => {
    const { sent, model } = standIn([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Looking.' },
          { type: 'tool_use', id: 't2', name: 'releases', input: {} },
        ],
      },
    ]);
    const step = await model.step({ system: 'rules', turns, tools: AGENT_TOOLS, final: false });
    expect(step).toEqual({
      text: 'Looking.',
      calls: [{ id: 't2', name: 'releases', input: {} }],
      cut: false,
    });
    const params = sent[0] as { messages: { role: string }[]; tools: { name: string }[] };
    expect(params.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(params.tools.map((t) => t.name)).toContain('propose');
    expect(JSON.stringify(params.messages[2])).toContain('&lt;/data>');
  });

  test('a refusal is no step, and a call cut off by the token limit is marked, not run', async () => {
    const { model } = standIn([
      { stop_reason: 'refusal', content: [] },
      {
        stop_reason: 'max_tokens',
        content: [{ type: 'tool_use', id: 't3', name: 'propose', input: { kind: 'sta' } }],
      },
    ]);
    expect(
      await model.step({ system: 'rules', turns, tools: AGENT_TOOLS, final: false }),
    ).toBeNull();
    expect(
      await model.step({ system: 'rules', turns, tools: AGENT_TOOLS, final: false }),
    ).toMatchObject({
      cut: true,
    });
  });

  test('the last step still shows the tools, as the exchange holds calls to them, but none may be called', async () => {
    const { sent, model } = standIn([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here is what I found.' }] },
    ]);
    await model.step({ system: 'rules', turns, tools: AGENT_TOOLS, final: true });
    const params = sent[0] as { tools: unknown[]; tool_choice: unknown };
    expect(params.tools.length).toBeGreaterThan(0);
    expect(params.tool_choice).toEqual({ type: 'none' });
  });

  test('every tool takes an object, and propose asks only for its kind', () => {
    for (const tool of AGENT_TOOLS) expect(tool.inputSchema.type).toBe('object');
    const propose = AGENT_TOOLS.find((tool) => tool.name === 'propose')!;
    expect(propose.inputSchema.required).toEqual(['kind']);
  });
});
