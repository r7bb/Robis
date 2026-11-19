import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  addMember,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  request,
  resetDatabase,
} from './harness.ts';

beforeEach(resetDatabase);
afterAll(closeHarness);

type Actor = Awaited<ReturnType<typeof createActor>>;

async function room(actor: Actor, workspaceId: string, name?: string) {
  if (name) {
    const made = await request(`/workspaces/${workspaceId}/channels`, {
      method: 'POST',
      payload: { name },
      actor,
    });
    return made.json().channel as { id: string; name: string };
  }
  const listed = await request(`/workspaces/${workspaceId}/channels`, { actor });
  return listed.json().channels[0] as { id: string; name: string };
}

async function say(actor: Actor, workspaceId: string, channelId: string, body: string) {
  const posted = await request(`/workspaces/${workspaceId}/channels/${channelId}/messages`, {
    method: 'POST',
    payload: { body },
    actor,
  });
  expect(posted.statusCode).toBe(201);
  return posted.json().message as { id: string };
}

async function issue(actor: Actor, workspaceId: string, projectId: string, title: string) {
  const made = await request(`/workspaces/${workspaceId}/projects/${projectId}/issues`, {
    method: 'POST',
    payload: { title },
    actor,
  });
  return made.json().issue as { id: string; key: string };
}

/** A workspace with one project and four issues, so REL-4 exists beside REL-40-ish keys. */
async function setUp() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id, 'Release');
  const made = [];
  for (const title of ['One', 'Two', 'Three', 'Four']) {
    made.push(await issue(owner, workspace.id, project.id, title));
  }
  return { owner, workspace, project, fourth: made[3]! };
}

describe('where an issue is talked about in chat', () => {
  test('finds messages naming its key, newest first, with the room', async () => {
    const { owner, workspace, fourth } = await setUp();
    const general = await room(owner, workspace.id);
    const design = await room(owner, workspace.id, 'design');

    await say(owner, workspace.id, general.id, `Can someone look at ${fourth.key}?`);
    await say(owner, workspace.id, general.id, 'Nothing to do with it');
    const later = await say(
      owner,
      workspace.id,
      design.id,
      `${fourth.key.toLowerCase()} needs a mock`,
    );

    const response = await request(`/workspaces/${workspace.id}/issues/${fourth.id}/discussion`, {
      actor: owner,
    });
    expect(response.statusCode).toBe(200);
    const { messages } = response.json();
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe(later.id);
    expect(messages[0].channelName).toBe('design');
    expect(messages[1].channelName).toBe('general');
    expect(messages[1].authorName).toBe('Owner');
  });

  test('a key written with leading zeros is the same issue', async () => {
    const { owner, workspace, fourth } = await setUp();
    const general = await room(owner, workspace.id);
    const [prefix, number] = fourth.key.split('-');
    await say(owner, workspace.id, general.id, `See ${prefix}-00${number}`);

    const response = await request(`/workspaces/${workspace.id}/issues/${fourth.id}/discussion`, {
      actor: owner,
    });
    expect(response.json().messages).toHaveLength(1);
  });

  test('a longer key with the same start is not this issue', async () => {
    const { owner, workspace, fourth } = await setUp();
    const general = await room(owner, workspace.id);
    await say(owner, workspace.id, general.id, `${fourth.key}0 is a different issue`);
    await say(owner, workspace.id, general.id, `X${fourth.key} is not a key at all`);

    const response = await request(`/workspaces/${workspace.id}/issues/${fourth.id}/discussion`, {
      actor: owner,
    });
    expect(response.json().messages).toHaveLength(0);
  });

  test('another workspace’s rooms are never searched', async () => {
    const { owner, workspace, fourth } = await setUp();
    const other = await createWorkspace(owner, 'Elsewhere');
    const elsewhere = await room(owner, other.id);
    await say(owner, other.id, elsewhere.id, `${fourth.key} in another workspace`);

    const response = await request(`/workspaces/${workspace.id}/issues/${fourth.id}/discussion`, {
      actor: owner,
    });
    expect(response.json().messages).toHaveLength(0);
  });

  test('a stranger gets a 404, and so does an unknown issue', async () => {
    const { workspace, fourth } = await setUp();
    const stranger = await createActor('Stranger');

    const outside = await request(`/workspaces/${workspace.id}/issues/${fourth.id}/discussion`, {
      actor: stranger,
    });
    expect(outside.statusCode).toBe(404);

    const owner = await createActor('Second owner');
    const mine = await createWorkspace(owner, 'Mine');
    const missing = await request(`/workspaces/${mine.id}/issues/${fourth.id}/discussion`, {
      actor: owner,
    });
    expect(missing.statusCode).toBe(404);
  });

  test('a long message is cut to a preview', async () => {
    const { owner, workspace, fourth } = await setUp();
    const general = await room(owner, workspace.id);
    await say(owner, workspace.id, general.id, `${fourth.key} ${'x'.repeat(900)}`);

    const response = await request(`/workspaces/${workspace.id}/issues/${fourth.id}/discussion`, {
      actor: owner,
    });
    expect(response.json().messages[0].body.length).toBeLessThanOrEqual(280);
  });
});

describe('an issue by its key', () => {
  test('finds it in any case', async () => {
    const { owner, workspace, project, fourth } = await setUp();

    for (const typed of [fourth.key, fourth.key.toLowerCase()]) {
      const response = await request(`/workspaces/${workspace.id}/issue-keys/${typed}`, {
        actor: owner,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().issue).toEqual({
        id: fourth.id,
        projectId: project.id,
        key: fourth.key,
        title: 'Four',
      });
    }
  });

  test('a key that is not an issue here is a 404, and a malformed one too', async () => {
    const { owner, workspace, fourth } = await setUp();
    for (const typed of [
      `${fourth.key}0`,
      'NOPE-1',
      'not a key',
      `${fourth.key.split('-')[0]}-0`,
    ]) {
      const response = await request(
        `/workspaces/${workspace.id}/issue-keys/${encodeURIComponent(typed)}`,
        { actor: owner },
      );
      expect(response.statusCode).toBe(404);
    }
  });

  test('a guest can look one up; a stranger cannot', async () => {
    const { owner, workspace, fourth } = await setUp();
    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    const stranger = await createActor('Stranger');

    const asGuest = await request(`/workspaces/${workspace.id}/issue-keys/${fourth.key}`, {
      actor: guest,
    });
    expect(asGuest.statusCode).toBe(200);
    const asStranger = await request(`/workspaces/${workspace.id}/issue-keys/${fourth.key}`, {
      actor: stranger,
    });
    expect(asStranger.statusCode).toBe(404);
  });
});
