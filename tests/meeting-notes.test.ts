import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  type Actor,
  addMember,
  closeHarness,
  createActor,
  createWorkspace,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Meeting notes: whoever is in the meeting writes them, everyone who may
 * read the meeting reads them, and a save over a newer one is refused
 * rather than lost.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

type Notes = {
  notes: string;
  updatedAt: string | null;
  updatedByName: string | null;
  canEdit: boolean;
};

async function setUp() {
  const organiser = await createActor('Organiser');
  const attendee = await createActor('Attendee');
  const bystander = await createActor('Bystander');
  const workspace = await createWorkspace(organiser);
  await addMember(organiser, workspace.id, attendee, 'GUEST');
  await addMember(organiser, workspace.id, bystander, 'MEMBER');
  const ws = `/workspaces/${workspace.id}`;
  const made = await request(`${ws}/meetings`, {
    method: 'POST',
    actor: organiser,
    payload: {
      title: 'Retro',
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      attendeeIds: [attendee.id],
    },
  });
  const path = `${ws}/meetings/${made.json().meeting.id}/notes`;
  return { organiser, attendee, bystander, ws, path };
}

const read = async (actor: Actor, path: string) => (await request(path, { actor })).json() as Notes;
const save = (actor: Actor, path: string, notes: string, basedOn: string | null = null) =>
  request(path, { method: 'PUT', actor, payload: { notes, basedOn } });

describe('meeting notes', () => {
  test('empty at first; an attendee writes them, and everyone reads who did', async () => {
    const { attendee, bystander, path } = await setUp();
    expect(await read(attendee, path)).toEqual({
      notes: '',
      updatedAt: null,
      updatedByName: null,
      canEdit: true,
    });
    const saved = await save(attendee, path, '- [ ] Send the budget', null);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      notes: '- [ ] Send the budget',
      updatedByName: 'Attendee',
    });
    expect(await read(bystander, path)).toMatchObject({
      notes: '- [ ] Send the budget',
      canEdit: false,
    });
  });

  test('someone not in the meeting may read but not write', async () => {
    const { bystander, path } = await setUp();
    const refused = await save(bystander, path, 'Mine now');
    expect(refused.statusCode).toBe(403);
  });

  test('a save over a newer one is refused, and the newer notes are kept', async () => {
    const { organiser, attendee, path } = await setUp();
    const opened = await read(organiser, path);
    const first = await save(attendee, path, 'Attendee was first', opened.updatedAt);
    expect(first.statusCode).toBe(200);
    const second = await save(organiser, path, 'Organiser, from an old copy', opened.updatedAt);
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('notes_changed');
    expect((await read(organiser, path)).notes).toBe('Attendee was first');
    // Read again, the save goes through.
    const fresh = await read(organiser, path);
    expect((await save(organiser, path, 'Organiser, up to date', fresh.updatedAt)).statusCode).toBe(
      200,
    );
  });

  test('another workspace’s meeting is not found, and notes have a limit', async () => {
    const { organiser, path } = await setUp();
    const other = await createActor('Other');
    await createWorkspace(other, 'Theirs');
    expect((await request(path, { actor: other })).statusCode).toBe(404);
    expect((await save(organiser, path, 'x'.repeat(20_001))).statusCode).toBe(400);
  });
});
