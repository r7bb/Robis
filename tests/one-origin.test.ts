import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { closeHarness, createActor, getHarness, request, resetDatabase } from './harness.ts';

/**
 * One origin (stage 1, item 3): the web app reaches the API at /api on its
 * own origin, so the API no longer grants other sites access to anything.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

describe('another site', () => {
  test('is never told it may read a response', async () => {
    const actor = await createActor();
    const response = await request('/auth/me', {
      actor,
      headers: { origin: 'https://elsewhere.example' },
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  test('gets no answer to a preflight that would allow it', async () => {
    const { app } = await getHarness();
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/workspaces',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
      },
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
