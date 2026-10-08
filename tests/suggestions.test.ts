import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  addMember,
  breakSuggestions,
  closeHarness,
  createActor,
  createWorkspace,
  request,
  resetDatabase,
  setSuggestions,
  suggestionCalls,
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
