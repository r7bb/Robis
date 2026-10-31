import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createSuggestionClient, parseTriage } from '@robis/api/suggestions';
import {
  addMember,
  breakSuggestions,
  closeHarness,
  createActor,
  createWorkspace,
  request,
  resetDatabase,
  setSuggestions,
  setTriage,
  suggestionCalls,
} from './harness.ts';

/**
 * The composer's hints (stage 3, item 27): possible duplicates and a
 * suggested priority for a draft, from one route making one call to the
 * suggestion service per settled title.
 */

beforeEach(async () => {
  await resetDatabase();
  setSuggestions([]);
  setTriage(null);
});
afterAll(closeHarness);

function suggestionsUrl(workspaceId: string, title: string) {
  return `/workspaces/${workspaceId}/issues/suggestions?title=${encodeURIComponent(title)}`;
}

describe('suggestions for a draft', () => {
  test('answers with both hints from one call to the service', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    setSuggestions([{ id: 'abc', title: 'Rate limit the auth endpoints', score: 0.64 }]);
    setTriage({ priority: 'HIGH', score: 0.62 });

    const response = await request(suggestionsUrl(workspace.id, 'Throttle the auth endpoints'), {
      actor: owner,
    });

    expect(response.statusCode).toBe(200);
    const answer: unknown = response.json();
    expect(answer).toEqual({
      similar: [{ id: 'abc', title: 'Rate limit the auth endpoints', score: 0.64 }],
      suggestion: { priority: 'HIGH', score: 0.62 },
    });
    expect(suggestionCalls).toHaveLength(1);
  });

  test('passes a refusal through, so the composer can say why there is no priority', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    setTriage({ priority: null, trainedOn: 9, needed: 40 });

    const response = await request(suggestionsUrl(workspace.id, 'anything at all'), {
      actor: owner,
    });

    expect(response.json().suggestion).toEqual({ priority: null, trainedOn: 9, needed: 40 });
  });

  test('asks only about the caller’s own workspace', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    await request(suggestionsUrl(workspace.id, 'anything'), { actor: owner });

    // The ML service trusts whatever workspace id it is handed, so the id
    // crossing that boundary must be the one membership was checked against.
    expect(suggestionCalls).toEqual([{ workspaceId: workspace.id, title: 'anything' }]);
  });

  test('a non-member gets not found and the service is never called', async () => {
    const owner = await createActor('Owner');
    const stranger = await createActor('Stranger');
    const workspace = await createWorkspace(owner);
    setSuggestions([{ id: 'secret', title: 'Leaked title', score: 0.9 }]);

    const response = await request(suggestionsUrl(workspace.id, 'x'), { actor: stranger });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('Leaked title');
    expect(suggestionCalls).toHaveLength(0);
  });

  test('an unauthenticated caller is refused', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    const response = await request(suggestionsUrl(workspace.id, 'x'));

    expect(response.statusCode).toBe(401);
    expect(suggestionCalls).toHaveLength(0);
  });

  test('a guest may ask, because a guest may read issues', async () => {
    const owner = await createActor('Owner');
    const guest = await createActor('Guest');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, guest, 'GUEST');

    const response = await request(suggestionsUrl(workspace.id, 'x'), { actor: guest });

    expect(response.statusCode).toBe(200);
  });

  test('a blank or missing title is rejected rather than sent on', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    const blank = await request(suggestionsUrl(workspace.id, '   '), { actor: owner });
    const missing = await request(`/workspaces/${workspace.id}/issues/suggestions`, {
      actor: owner,
    });

    expect(blank.statusCode).toBe(400);
    expect(missing.statusCode).toBe(400);
    expect(suggestionCalls).toHaveLength(0);
  });

  test('a failing service degrades to no hints, not an error', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    breakSuggestions();

    const response = await request(suggestionsUrl(workspace.id, 'anything'), { actor: owner });

    expect(response.statusCode).toBe(200);
    const answer: unknown = response.json();
    expect(answer).toEqual({ similar: [], suggestion: null });
  });
});

describe('parseTriage', () => {
  test('keeps a well-formed prediction', () => {
    expect(parseTriage({ priority: 'MEDIUM', score: 0.5, trained_on: 60, needed: 40 })).toEqual({
      priority: 'MEDIUM',
      score: 0.5,
    });
  });

  test('turns a refusal into the counts the composer shows', () => {
    expect(
      parseTriage({ priority: null, score: null, reason: 'too few', trained_on: 9, needed: 40 }),
    ).toEqual({ priority: null, trainedOn: 9, needed: 40 });
  });

  test.each([
    ['an unknown priority', { priority: 'CRITICAL', score: 0.5 }],
    ['NONE, which is not a prediction', { priority: 'NONE', score: 0.5 }],
    ['a score above one', { priority: 'HIGH', score: 1.5 }],
    ['a score that is not a number', { priority: 'HIGH', score: 'high' }],
    ['a refusal with no counts', { priority: null }],
    ['nothing at all', null],
  ])('rejects %s', (_label, payload) => {
    expect(parseTriage(payload)).toBeNull();
  });
});

describe('the real suggestion client', () => {
  // A stand-in ML service on a random local port, so the HTTP path itself
  // (auth header, endpoint, parsing, failure handling) is exercised rather
  // than replaced by a stub.
  let answer: { status: number; body: unknown } = { status: 200, body: {} };
  const seen: { path: string; auth: string | null }[] = [];
  let lastRequestId: string | null = null;
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      seen.push({ path: new URL(req.url).pathname, auth: req.headers.get('authorization') });
      lastRequestId = req.headers.get('x-request-id');
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    },
  });
  afterAll(() => server.stop(true));

  const quiet = { warn() {} } as unknown as Parameters<typeof createSuggestionClient>[1];
  const client = createSuggestionClient(
    { url: `http://localhost:${server.port}`, token: 'secret', timeoutMs: 1000 },
    quiet,
  );

  test('asks the combined endpoint once, with the token, and parses both halves', async () => {
    answer = {
      status: 200,
      body: {
        similar: [{ id: 'i1', title: 'Login loops', score: 0.7 }],
        corpus_size: 10,
        triage: { priority: 'URGENT', score: 0.7, trained_on: 50, needed: 40 },
        model_age_seconds: 3,
      },
    };
    const before = seen.length;

    const result = await client.suggest('ws-1', 'Everything is down');

    expect(result).toEqual({
      similar: [{ id: 'i1', title: 'Login loops', score: 0.7 }],
      triage: { priority: 'URGENT', score: 0.7 },
    });
    expect(seen.slice(before)).toEqual([
      { path: '/workspaces/ws-1/suggestions', auth: 'Bearer secret' },
    ]);
  });

  test('passes a refusal through with its counts', async () => {
    answer = {
      status: 200,
      body: { similar: [], triage: { priority: null, score: null, trained_on: 3, needed: 40 } },
    };

    expect((await client.suggest('ws-1', 'x')).triage).toEqual({
      priority: null,
      trainedOn: 3,
      needed: 40,
    });
  });

  test('an error from the service becomes no hints', async () => {
    answer = { status: 500, body: { detail: 'boom' } };

    expect(await client.suggest('ws-1', 'x')).toEqual({ similar: [], triage: null });
  });

  test('forwards the request id, so one trace spans the API and the model', async () => {
    answer = { status: 200, body: { similar: [], triage: null } };

    await client.suggest('ws-1', 'x', null, { requestId: 'trace-abc-12345' });

    expect(lastRequestId).toBe('trace-abc-12345');
  });

  test('a malformed half becomes no hint, and leaves the other half', async () => {
    answer = {
      status: 200,
      body: {
        similar: [{ id: 'i1', title: 'Kept', score: 0.9 }],
        triage: { priority: 'SOMEDAY', score: 3 },
      },
    };

    expect(await client.suggest('ws-1', 'x')).toEqual({
      similar: [{ id: 'i1', title: 'Kept', score: 0.9 }],
      triage: null,
    });
  });
});
