import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createSuggestionClient, parseTriage } from '@robis/api/suggestions';
import {
  addMember,
  breakSuggestions,
  breakTriage,
  closeHarness,
  createActor,
  createWorkspace,
  request,
  resetDatabase,
  setSuggestions,
  setTriage,
  suggestionCalls,
  triageCalls,
} from './harness.ts';

beforeEach(async () => {
  await resetDatabase();
  setSuggestions([]);
});
afterAll(closeHarness);

function similarUrl(workspaceId: string, title: string) {
  return `/workspaces/${workspaceId}/issues/similar?title=${encodeURIComponent(title)}`;
}

describe('duplicate suggestions', () => {
  test('returns what the service found', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    setSuggestions([{ id: 'abc', title: 'Rate limit the auth endpoints', score: 0.64 }]);

    const response = await request(similarUrl(workspace.id, 'Throttle the auth endpoints'), {
      actor: owner,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().similar).toHaveLength(1);
    expect(response.json().similar[0].title).toBe('Rate limit the auth endpoints');
  });

  test('asks only about the caller’s own workspace', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    await request(similarUrl(workspace.id, 'anything'), { actor: owner });

    // The ML service trusts whatever workspace id it is handed, so the id
    // crossing that boundary must be the one membership was checked against.
    expect(suggestionCalls).toHaveLength(1);
    expect(suggestionCalls[0]!.workspaceId).toBe(workspace.id);
  });

  test('a non-member gets not found and the service is never called', async () => {
    const owner = await createActor('Owner');
    const stranger = await createActor('Stranger');
    const workspace = await createWorkspace(owner);

    setSuggestions([{ id: 'secret', title: 'Leaked title', score: 0.9 }]);

    const response = await request(similarUrl(workspace.id, 'x'), { actor: stranger });

    expect(response.statusCode).toBe(404);
    // Not merely filtered out of the response: never asked for, so a title
    // cannot escape through a log line or a timing difference either.
    expect(suggestionCalls).toHaveLength(0);
  });

  test('an unauthenticated caller is refused', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    const response = await request(similarUrl(workspace.id, 'x'));

    expect(response.statusCode).toBe(401);
    expect(suggestionCalls).toHaveLength(0);
  });

  test('a guest may ask, because a guest may read issues', async () => {
    const owner = await createActor('Owner');
    const guest = await createActor('Guest');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, guest, 'GUEST');

    const response = await request(similarUrl(workspace.id, 'x'), { actor: guest });

    expect(response.statusCode).toBe(200);
  });

  test('a blank title is rejected rather than sent on', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    const response = await request(similarUrl(workspace.id, '   '), { actor: owner });

    expect(response.statusCode).toBe(400);
    expect(suggestionCalls).toHaveLength(0);
  });

  /**
   * The property the whole feature rests on: suggestions are a nicety and
   * filing an issue is the job, so nothing about a broken ML service may
   * reach the person writing one.
   */
  test('a failing service degrades to no suggestions, not an error', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    breakSuggestions();

    const response = await request(similarUrl(workspace.id, 'anything'), { actor: owner });

    expect(response.statusCode).toBe(200);
    expect(response.json().similar).toEqual([]);
  });
});

function triageUrl(workspaceId: string, title: string) {
  return `/workspaces/${workspaceId}/issues/triage?title=${encodeURIComponent(title)}`;
}

describe('priority suggestions', () => {
  beforeEach(() => setTriage(null));

  test('returns the suggested priority and its score', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    setTriage({ priority: 'HIGH', score: 0.62 });

    const response = await request(triageUrl(workspace.id, 'Login fails for everyone'), {
      actor: owner,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().suggestion).toEqual({ priority: 'HIGH', score: 0.62 });
  });

  test('passes a refusal through, so the composer can say why there is none', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    setTriage({ priority: null, trainedOn: 9, needed: 40 });

    const response = await request(triageUrl(workspace.id, 'anything at all'), { actor: owner });

    expect(response.json().suggestion).toEqual({ priority: null, trainedOn: 9, needed: 40 });
  });

  test('asks only about the caller’s own workspace', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    await request(triageUrl(workspace.id, 'anything'), { actor: owner });

    expect(triageCalls).toHaveLength(1);
    expect(triageCalls[0]!.workspaceId).toBe(workspace.id);
  });

  test('a non-member gets not found and the service is never called', async () => {
    const owner = await createActor('Owner');
    const stranger = await createActor('Stranger');
    const workspace = await createWorkspace(owner);
    setTriage({ priority: 'URGENT', score: 0.9 });

    const response = await request(triageUrl(workspace.id, 'x'), { actor: stranger });

    expect(response.statusCode).toBe(404);
    expect(triageCalls).toHaveLength(0);
  });

  test('a broken service answers with no suggestion, never an error', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    breakTriage();

    const response = await request(triageUrl(workspace.id, 'anything'), { actor: owner });

    expect(response.statusCode).toBe(200);
    expect(response.json().suggestion).toBeNull();
  });

  test('a guest may read suggestions like any other issue data', async () => {
    const owner = await createActor('Owner');
    const guest = await createActor('Guest');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, guest, 'GUEST');
    setTriage({ priority: 'LOW', score: 0.4 });

    const response = await request(triageUrl(workspace.id, 'anything'), { actor: guest });

    expect(response.statusCode).toBe(200);
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

describe('the priority route rejects a draft with no title', () => {
  test('a missing title is a bad request', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    const response = await request(`/workspaces/${workspace.id}/issues/triage`, { actor: owner });

    expect(response.statusCode).toBe(400);
  });
});

describe('the real suggestion client', () => {
  // A stand-in ML service on a random local port, so the HTTP path itself
  // (auth header, endpoint, parsing, failure handling) is exercised rather
  // than replaced by a stub.
  let answer: { status: number; body: unknown } = { status: 200, body: {} };
  const seen: { path: string; auth: string | null }[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      seen.push({ path: new URL(req.url).pathname, auth: req.headers.get('authorization') });
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    },
  });
  afterAll(() => server.stop(true));

  const quiet = { warn() {} } as unknown as Parameters<typeof createSuggestionClient>[1];
  const client = createSuggestionClient(
    { url: `http://localhost:${server.port}`, token: 'secret', timeoutMs: 1000 },
    quiet,
  );

  test('asks the triage endpoint with the token and parses the answer', async () => {
    answer = { status: 200, body: { priority: 'URGENT', score: 0.7, trained_on: 50, needed: 40 } };

    const result = await client.triage('ws-1', 'Everything is down');

    expect(result).toEqual({ priority: 'URGENT', score: 0.7 });
    expect(seen.at(-1)).toEqual({ path: '/workspaces/ws-1/triage', auth: 'Bearer secret' });
  });

  test('passes a refusal through with its counts', async () => {
    answer = { status: 200, body: { priority: null, score: null, trained_on: 3, needed: 40 } };

    expect(await client.triage('ws-1', 'x')).toEqual({ priority: null, trainedOn: 3, needed: 40 });
  });

  test('an error from the service becomes no suggestion', async () => {
    answer = { status: 500, body: { detail: 'boom' } };

    expect(await client.triage('ws-1', 'x')).toBeNull();
    expect(await client.similar('ws-1', 'x')).toEqual([]);
  });

  test('a malformed answer becomes no suggestion', async () => {
    answer = { status: 200, body: { priority: 'SOMEDAY', score: 3 } };

    expect(await client.triage('ws-1', 'x')).toBeNull();
  });
});
