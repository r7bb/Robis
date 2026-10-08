import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  addMember,
  closeHarness,
  createActor,
  createWorkspace,
  request,
  resetDatabase,
} from './harness.ts';

beforeEach(resetDatabase);
afterAll(closeHarness);

/** Every workspace is created with one, so tests start from a real room. */
async function generalChannel(actor: Awaited<ReturnType<typeof createActor>>, workspaceId: string) {
  const response = await request(`/workspaces/${workspaceId}/channels`, { actor });
  return response.json().channels[0];
}

describe('channels', () => {
  test('a new workspace comes with a general channel', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    const response = await request(`/workspaces/${workspace.id}/channels`, { actor: owner });

    expect(response.statusCode).toBe(200);
    expect(response.json().channels).toHaveLength(1);
    expect(response.json().channels[0].name).toBe('general');
  });

  test('names are normalised to lowercase hyphenated form', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    const response = await request(`/workspaces/${workspace.id}/channels`, {
      method: 'POST',
      payload: { name: '  Design   Review  ' },
      actor: owner,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().channel.name).toBe('design-review');
  });

  test('a duplicate name is a conflict, not a second channel', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    await request(`/workspaces/${workspace.id}/channels`, {
      method: 'POST',
      payload: { name: 'standup' },
      actor: owner,
    });

    // Differently cased on purpose: it is the same room to a human, and the
    // normalisation is what makes the unique index agree.
    const second = await request(`/workspaces/${workspace.id}/channels`, {
      method: 'POST',
      payload: { name: 'STANDUP' },
      actor: owner,
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('channel_exists');
  });

  test('a name of pure punctuation is rejected rather than stored empty', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    const response = await request(`/workspaces/${workspace.id}/channels`, {
      method: 'POST',
      payload: { name: '###' },
      actor: owner,
    });

    expect(response.statusCode).toBe(400);
  });

  test('a guest may not create a channel', async () => {
    const owner = await createActor('Owner');
    const guest = await createActor('Guest');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id,guest, 'GUEST');

    const response = await request(`/workspaces/${workspace.id}/channels`, {
      method: 'POST',
      payload: { name: 'secret-plans' },
      actor: guest,
    });

    expect(response.statusCode).toBe(403);
  });

  test('a non-member sees not found, not forbidden', async () => {
    const owner = await createActor('Owner');
    const stranger = await createActor('Stranger');
    const workspace = await createWorkspace(owner);

    const response = await request(`/workspaces/${workspace.id}/channels`, { actor: stranger });

    // 404 rather than 403: a 403 would confirm the workspace exists.
    expect(response.statusCode).toBe(404);
  });
});

describe('messages', () => {
  test('a member can post and read back', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const channel = await generalChannel(owner, workspace.id);

    const posted = await request(
      `/workspaces/${workspace.id}/channels/${channel.id}/messages`,
      { method: 'POST', payload: { body: 'Morning' }, actor: owner },
    );

    expect(posted.statusCode).toBe(201);
    expect(posted.json().message.authorName).toBe('Owner');

    const listed = await request(`/workspaces/${workspace.id}/channels/${channel.id}/messages`, {
      actor: owner,
    });

    expect(listed.json().messages).toHaveLength(1);
    expect(listed.json().messages[0].body).toBe('Morning');
  });

  test('a whitespace-only message is rejected', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const channel = await generalChannel(owner, workspace.id);

    const response = await request(
      `/workspaces/${workspace.id}/channels/${channel.id}/messages`,
      { method: 'POST', payload: { body: '   ' }, actor: owner },
    );

    // The schema trims before checking the minimum, so this is not a
    // one-space message -- it is an empty one.
    expect(response.statusCode).toBe(400);
  });

  test('guests may talk', async () => {
    const owner = await createActor('Owner');
    const guest = await createActor('Guest');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id,guest, 'GUEST');
    const channel = await generalChannel(owner, workspace.id);

    const response = await request(
      `/workspaces/${workspace.id}/channels/${channel.id}/messages`,
      { method: 'POST', payload: { body: 'Hello' }, actor: guest },
    );

    expect(response.statusCode).toBe(201);
  });

  test('history pages backwards, newest first, without repeats', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const channel = await generalChannel(owner, workspace.id);

    for (let index = 0; index < 5; index += 1) {
      await request(`/workspaces/${workspace.id}/channels/${channel.id}/messages`, {
        method: 'POST',
        payload: { body: `message ${index}` },
        actor: owner,
      });
    }

    const first = await request(
      `/workspaces/${workspace.id}/channels/${channel.id}/messages?limit=2`,
      { actor: owner },
    );

    expect(first.json().messages.map((m: { body: string }) => m.body)).toEqual([
      'message 4',
      'message 3',
    ]);
    expect(first.json().nextCursor).not.toBeNull();

    const second = await request(
      `/workspaces/${workspace.id}/channels/${channel.id}/messages?limit=2&cursor=${encodeURIComponent(first.json().nextCursor)}`,
      { actor: owner },
    );

    expect(second.json().messages.map((m: { body: string }) => m.body)).toEqual([
      'message 2',
      'message 1',
    ]);
  });

  test('a member cannot read another workspace’s channel by id', async () => {
    const owner = await createActor('Owner');
    const outsider = await createActor('Outsider');
    const theirs = await createWorkspace(owner);
    const mine = await createWorkspace(outsider);
    const theirChannel = await generalChannel(owner, theirs.id);

    // Authenticated, a member of *something*, and guessing an id from
    // elsewhere. The workspace in the path is their own, so membership
    // passes -- only the tenancy check on the channel stops this.
    const response = await request(
      `/workspaces/${mine.id}/channels/${theirChannel.id}/messages`,
      { actor: outsider },
    );

    expect(response.statusCode).toBe(404);
  });

  test('an author can delete their own message; a peer cannot', async () => {
    const owner = await createActor('Owner');
    const member = await createActor('Member');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id,member, 'MEMBER');
    const channel = await generalChannel(owner, workspace.id);

    const posted = await request(
      `/workspaces/${workspace.id}/channels/${channel.id}/messages`,
      { method: 'POST', payload: { body: 'Mine' }, actor: member },
    );
    const messageId = posted.json().message.id;

    const peer = await createActor('Peer');
    await addMember(owner, workspace.id,peer, 'MEMBER');

    const refused = await request(`/workspaces/${workspace.id}/messages/${messageId}`, {
      method: 'DELETE',
      actor: peer,
    });
    expect(refused.statusCode).toBe(403);

    const allowed = await request(`/workspaces/${workspace.id}/messages/${messageId}`, {
      method: 'DELETE',
      actor: member,
    });
    expect(allowed.statusCode).toBe(204);
  });

  test('an admin can moderate anyone’s message', async () => {
    const owner = await createActor('Owner');
    const member = await createActor('Member');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id,member, 'MEMBER');
    const channel = await generalChannel(owner, workspace.id);

    const posted = await request(
      `/workspaces/${workspace.id}/channels/${channel.id}/messages`,
      { method: 'POST', payload: { body: 'Off topic' }, actor: member },
    );

    const response = await request(
      `/workspaces/${workspace.id}/messages/${posted.json().message.id}`,
      { method: 'DELETE', actor: owner },
    );

    expect(response.statusCode).toBe(204);
  });

  test('deleting a channel takes its messages with it', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const channel = await generalChannel(owner, workspace.id);

    await request(`/workspaces/${workspace.id}/channels/${channel.id}/messages`, {
      method: 'POST',
      payload: { body: 'Soon to be gone' },
      actor: owner,
    });

    const deleted = await request(`/workspaces/${workspace.id}/channels/${channel.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    expect(deleted.statusCode).toBe(204);

    const after = await request(`/workspaces/${workspace.id}/channels/${channel.id}/messages`, {
      actor: owner,
    });
    expect(after.statusCode).toBe(404);
  });
});
