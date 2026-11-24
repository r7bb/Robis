import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  documents,
  documentVersions,
  recordVersion,
  VERSION_EVERY_MS,
  VERSIONS_KEPT,
} from '@robis/database';
import { eq } from 'drizzle-orm';
import {
  closeHarness,
  createActor,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * History: a document's text kept now and then as it changes, at most one
 * in ten minutes and only when it reads differently, the latest fifty kept;
 * read by anyone who may read the document, and never another workspace's.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const MINUTE = 60_000;

async function documentIn() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const { db } = await getHarness();
  const [document] = await db
    .insert(documents)
    .values({ workspaceId: workspace.id, title: 'Plan', createdBy: owner.id })
    .returning();
  return { owner, workspace, document: document!, ws: `/workspaces/${workspace.id}` };
}

describe('keeping versions', () => {
  test('the first edit is kept; more within ten minutes are not; later, a changed one is', async () => {
    const { document } = await documentIn();
    const { db } = await getHarness();
    const start = new Date('2026-11-24T10:00:00Z');
    const at = (minutes: number) => new Date(start.getTime() + minutes * MINUTE);

    expect(await recordVersion(db, document.id, 'One', at(0))).toBe(true);
    expect(await recordVersion(db, document.id, 'One two', at(3))).toBe(false);
    expect(VERSION_EVERY_MS).toBe(10 * MINUTE);
    expect(await recordVersion(db, document.id, 'One two three', at(11))).toBe(true);
    // Unchanged since the last kept: not kept again, however long after.
    expect(await recordVersion(db, document.id, 'One two three', at(60))).toBe(false);

    const kept = await db
      .select({ text: documentVersions.text })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, document.id));
    expect(kept.map((v) => v.text).sort()).toEqual(['One', 'One two three']);
  });

  test('only the latest fifty stay', async () => {
    const { document } = await documentIn();
    const { db } = await getHarness();
    for (let i = 0; i < VERSIONS_KEPT + 3; i++) {
      await recordVersion(
        db,
        document.id,
        `Draft ${i}`,
        new Date(Date.UTC(2026, 10, 1) + i * 11 * MINUTE),
      );
    }
    const kept = await db
      .select({ text: documentVersions.text })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, document.id));
    expect(kept).toHaveLength(VERSIONS_KEPT);
    expect(kept.map((v) => v.text)).not.toContain('Draft 0');
    expect(kept.map((v) => v.text)).toContain(`Draft ${VERSIONS_KEPT + 2}`);
  });
});

describe('reading history', () => {
  test('newest first with a preview, and one whole', async () => {
    const { owner, document, ws } = await documentIn();
    const { db } = await getHarness();
    await recordVersion(db, document.id, 'First draft', new Date(Date.now() - 30 * MINUTE));
    await recordVersion(db, document.id, `Second draft ${'x'.repeat(300)}`, new Date());

    const listed = (
      await request(`${ws}/documents/${document.id}/versions`, { actor: owner })
    ).json();
    expect(listed.versions).toHaveLength(2);
    expect(listed.versions[0].preview.startsWith('Second draft')).toBe(true);
    expect(listed.versions[0].preview.length).toBe(160);
    expect(listed.versions[0].length).toBe(313);

    const one = await request(`${ws}/documents/${document.id}/versions/${listed.versions[1].id}`, {
      actor: owner,
    });
    expect(one.json().version.text).toBe('First draft');
  });

  test('another workspace’s document, or a version of another document, is not found', async () => {
    const { owner, document, ws } = await documentIn();
    const { db } = await getHarness();
    await recordVersion(db, document.id, 'Secret plan');
    const other = await createActor('Other');
    const theirs = await createWorkspace(other, 'Theirs');
    const across = await request(`/workspaces/${theirs.id}/documents/${document.id}/versions`, {
      actor: other,
    });
    expect(across.statusCode).toBe(404);

    const [second] = await db
      .insert(documents)
      .values({ workspaceId: document.workspaceId, title: 'Other doc', createdBy: owner.id })
      .returning();
    const [version] = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, document.id));
    const mismatched = await request(`${ws}/documents/${second!.id}/versions/${version!.id}`, {
      actor: owner,
    });
    expect(mismatched.statusCode).toBe(404);
  });
});

describe('keeping the text before a restore', () => {
  test('kept however soon after the last, but not twice the same', async () => {
    const { owner, document, ws } = await documentIn();
    const { db } = await getHarness();
    await recordVersion(db, document.id, 'Monday');
    // The server's own copy is what is kept: here, an empty document.
    const path = `${ws}/documents/${document.id}/versions`;
    const first = await request(path, { method: 'POST', actor: owner, payload: {} });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ kept: boolean }>()).toEqual({ kept: true });
    const again = await request(path, { method: 'POST', actor: owner, payload: {} });
    expect(again.json<{ kept: boolean }>()).toEqual({ kept: false });
    const listed = (await request(path, { actor: owner })).json();
    expect(listed.versions.map((v: { preview: string }) => v.preview)).toEqual(['', 'Monday']);
  });
});
