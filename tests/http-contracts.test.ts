import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from '@robis/api/contract';
import { contract, contracts, openApiDocument, pathFor } from '@robis/shared';
import Fastify from 'fastify';
import { z } from 'zod';
import {
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Typed HTTP contracts (stage 2, item 20): each route is described once, in
 * @robis/shared, and the API serves it, the web app calls it and the OpenAPI
 * document describes it from that one description.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const ROOT = resolve(import.meta.dir, '..');

/**
 * Routes not yet moved onto a contract. Moved a group at a time; this list
 * only shrinks, and the test fails on an entry that has a contract now.
 */
const PENDING: readonly string[] = [
  'DELETE /auth/me',
  'DELETE /auth/sessions',
  'GET /auth/me',
  'GET /auth/me/events',
  'GET /auth/sessions',
  'GET /auth/username-available',
  'PATCH /auth/me',
  'POST /auth/email/resend',
  'POST /auth/email/verify',
  'POST /auth/login',
  'POST /auth/logout',
  'POST /auth/me/consent',
  'POST /auth/me/events/verify',
  'POST /auth/me/username/confirm',
  'POST /auth/password',
  'POST /auth/password/forgot',
  'POST /auth/password/reset',
  'POST /auth/register',
  'POST /auth/signup',
  'PUT /auth/me/avatar',
  'PUT /auth/me/avatar/generated',
];

/** Served outside the API's contract: health and the like. */
const OUTSIDE: readonly string[] = [
  'GET /health',
  // These answer with image bytes, streamed from storage, not JSON.
  'GET /workspaces/:workspaceId/attachments/:attachmentId',
  'GET /users/:userId/avatar',
];

describe('route contracts', () => {
  test('every contract is served, and every served route has one', async () => {
    const { app } = await getHarness();
    const served = new Set(app.registeredRoutes.map((r) => `${r.method} ${r.url}`));
    const described = new Set(Object.values(contracts).map((c) => `${c.method} ${c.path}`));

    expect([...described].filter((route) => !served.has(route))).toEqual([]);
    const undescribed = [...served].filter(
      (route) => !described.has(route) && !OUTSIDE.includes(route),
    );
    expect(undescribed.filter((route) => !PENDING.includes(route)).sort()).toEqual([]);
    // Pending entries that now have a contract come off the list.
    expect(PENDING.filter((route) => described.has(route))).toEqual([]);
  });

  test('a response carries only what its contract names', async () => {
    const actor = await createActor('Owner');
    const workspace = await createWorkspace(actor, 'Contracted');
    const response = await request(`/workspaces/${workspace.id}`, { actor });
    expect(response.statusCode).toBe(200);
    expect(Object.keys(response.json().workspace).sort()).toEqual(
      Object.keys(contracts['workspaces.get'].response.shape.workspace.shape).sort(),
    );
  });

  test('an updated issue answers with its key, as every other issue answer does', async () => {
    // The update used to answer without it, while the web app's type said it was there.
    const actor = await createActor('Owner');
    const workspace = await createWorkspace(actor, 'Keys');
    const project = await createProject(actor, workspace.id);
    const created = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      actor,
      payload: { title: 'Has a key' },
    });
    const { key } = created.json().issue;
    const updated = await request(`/workspaces/${workspace.id}/issues/${created.json().issue.id}`, {
      method: 'PATCH',
      actor,
      payload: { title: 'Still has a key' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().issue).toMatchObject({ key, title: 'Still has a key' });
    expect(updated.json().issue).not.toHaveProperty('searchVector');
  });

  test('a document answer carries its title and dates, never its stored state', async () => {
    // Created and renamed documents used to answer with the whole row: the
    // editing state's bytes and the plain-text copy kept for search.
    const actor = await createActor('Owner');
    const workspace = await createWorkspace(actor, 'Docs');
    const created = await request(`/workspaces/${workspace.id}/documents`, {
      method: 'POST',
      actor,
      payload: { title: 'Plan' },
    });
    expect(created.statusCode).toBe(201);
    const renamed = await request(
      `/workspaces/${workspace.id}/documents/${created.json().document.id}`,
      { method: 'PATCH', actor, payload: { title: 'The plan' } },
    );
    for (const answer of [created.json().document, renamed.json().document]) {
      expect(Object.keys(answer).sort()).toEqual(
        ['createdAt', 'id', 'projectId', 'title', 'updatedAt'].sort(),
      );
    }
  });

  test('a handler that answers outside its contract is a server error, not a reply', async () => {
    const app = Fastify();
    const route = contract({
      method: 'GET',
      path: '/broken',
      summary: 'Answers with the wrong shape.',
      response: z.object({ count: z.number() }),
    });
    // @ts-expect-error -- the handler's return type is checked against the contract too
    serve(app, route, {}, async () => ({ count: 'three' }));
    const response = await app.inject({ method: 'GET', url: '/broken' });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('three');
    await app.close();
  });

  test('input is parsed before the handler sees it', async () => {
    const app = Fastify();
    const route = contract({
      method: 'POST',
      path: '/things/:id',
      summary: 'Echoes what it was given.',
      params: z.object({ id: z.uuid() }),
      body: z.object({ name: z.string().min(1) }),
      response: z.object({ id: z.string(), name: z.string() }),
    });
    serve(app, route, {}, async (_request, { params, body }) => ({
      id: params.id,
      name: body.name,
    }));
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const ok = await app.inject({ method: 'POST', url: `/things/${id}`, payload: { name: 'x' } });
    const echoed: unknown = ok.json();
    expect(echoed).toEqual({ id, name: 'x' });
    const badBody = await app.inject({ method: 'POST', url: `/things/${id}`, payload: {} });
    expect(badBody.statusCode).toBe(400);
    const badParam = await app.inject({
      method: 'POST',
      url: '/things/nope',
      payload: { name: 'x' },
    });
    expect(badParam.statusCode).toBe(400);
    await app.close();
  });

  test('paths are filled in and encoded, and a missing parameter is refused', () => {
    expect(pathFor('/workspaces/:workspaceId/activity', { workspaceId: 'a b' })).toBe(
      '/workspaces/a%20b/activity',
    );
    expect(() => pathFor('/workspaces/:workspaceId', {})).toThrow(/workspaceId/);
  });

  test('the OpenAPI document is generated from the contracts, and current', () => {
    const written = readFileSync(join(ROOT, 'docs/openapi.json'), 'utf8');
    expect(written).toBe(`${JSON.stringify(openApiDocument(), null, 2)}\n`);
  });
});
