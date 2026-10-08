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

/** Far enough ahead that it never lands in the "already started" grace window. */
function soon(hoursFromNow = 2): string {
  return new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();
}

describe('scheduling', () => {
  test('the organiser is an attendee who has already said yes', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    const created = await request(`/workspaces/${workspace.id}/meetings`, {
      method: 'POST',
      payload: { title: 'Sprint planning', startsAt: soon() },
      actor: owner,
    });

    expect(created.statusCode).toBe(201);

    const listed = await request(`/workspaces/${workspace.id}/meetings`, { actor: owner });
    const meeting = listed.json().meetings[0];

    expect(meeting.title).toBe('Sprint planning');
    expect(meeting.attendees).toHaveLength(1);
    expect(meeting.attendees[0].response).toBe('yes');
  });

  test('invitees start pending, which is not the same as declining', async () => {
    const owner = await createActor('Owner');
    const member = await createActor('Member');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, member, 'MEMBER');

    await request(`/workspaces/${workspace.id}/meetings`, {
      method: 'POST',
      payload: { title: 'Retro', startsAt: soon(), attendeeIds: [member.id] },
      actor: owner,
    });

    const listed = await request(`/workspaces/${workspace.id}/meetings`, { actor: owner });
    const invited = listed
      .json()
      .meetings[0].attendees.find((a: { userId: string }) => a.userId === member.id);

    expect(invited.response).toBe('pending');
  });

  test('an invitee from outside the workspace is dropped, not attached', async () => {
    const owner = await createActor('Owner');
    const stranger = await createActor('Stranger');
    const workspace = await createWorkspace(owner);

    // Taking the id at face value would let anyone put a row in a stranger's
    // calendar, and confirm that a given user id exists.
    const created = await request(`/workspaces/${workspace.id}/meetings`, {
      method: 'POST',
      payload: { title: 'Not for you', startsAt: soon(), attendeeIds: [stranger.id] },
      actor: owner,
    });

    expect(created.statusCode).toBe(201);

    const listed = await request(`/workspaces/${workspace.id}/meetings`, { actor: owner });
    expect(listed.json().meetings[0].attendees).toHaveLength(1);
    expect(listed.json().meetings[0].attendees[0].userId).toBe(owner.id);
  });

  test('a non-https join link is refused', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    for (const joinUrl of ['http://meet.example.com/x', 'javascript:alert(1)']) {
      const response = await request(`/workspaces/${workspace.id}/meetings`, {
        method: 'POST',
        payload: { title: 'Bad link', startsAt: soon(), joinUrl },
        actor: owner,
      });

      expect(response.statusCode).toBe(400);
    }
  });

  test('a guest may read meetings but not create one', async () => {
    const owner = await createActor('Owner');
    const guest = await createActor('Guest');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, guest, 'GUEST');

    const listed = await request(`/workspaces/${workspace.id}/meetings`, { actor: guest });
    expect(listed.statusCode).toBe(200);

    const created = await request(`/workspaces/${workspace.id}/meetings`, {
      method: 'POST',
      payload: { title: 'Guest meeting', startsAt: soon() },
      actor: guest,
    });
    expect(created.statusCode).toBe(403);
  });
});

describe('responding', () => {
  test('a member answers for themselves', async () => {
    const owner = await createActor('Owner');
    const member = await createActor('Member');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, member, 'MEMBER');

    const created = await request(`/workspaces/${workspace.id}/meetings`, {
      method: 'POST',
      payload: { title: 'Design review', startsAt: soon(), attendeeIds: [member.id] },
      actor: owner,
    });
    const meetingId = created.json().meeting.id;

    const answered = await request(`/workspaces/${workspace.id}/meetings/${meetingId}/response`, {
      method: 'POST',
      payload: { response: 'no' },
      actor: member,
    });

    expect(answered.statusCode).toBe(200);

    const listed = await request(`/workspaces/${workspace.id}/meetings`, { actor: owner });
    const theirs = listed
      .json()
      .meetings[0].attendees.find((a: { userId: string }) => a.userId === member.id);

    expect(theirs.response).toBe('no');
  });

  test('someone never invited can still reply, and is added', async () => {
    const owner = await createActor('Owner');
    const member = await createActor('Member');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, member, 'MEMBER');

    const created = await request(`/workspaces/${workspace.id}/meetings`, {
      method: 'POST',
      payload: { title: 'Open to all', startsAt: soon() },
      actor: owner,
    });

    const answered = await request(
      `/workspaces/${workspace.id}/meetings/${created.json().meeting.id}/response`,
      { method: 'POST', payload: { response: 'yes' }, actor: member },
    );

    expect(answered.statusCode).toBe(200);

    const listed = await request(`/workspaces/${workspace.id}/meetings`, { actor: owner });
    expect(listed.json().meetings[0].attendees).toHaveLength(2);
  });
});

describe('rescheduling and cancelling', () => {
  test('moving the start clears everyone else’s answer', async () => {
    const owner = await createActor('Owner');
    const member = await createActor('Member');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, member, 'MEMBER');

    const created = await request(`/workspaces/${workspace.id}/meetings`, {
      method: 'POST',
      payload: { title: 'Moving target', startsAt: soon(), attendeeIds: [member.id] },
      actor: owner,
    });
    const meetingId = created.json().meeting.id;

    await request(`/workspaces/${workspace.id}/meetings/${meetingId}/response`, {
      method: 'POST',
      payload: { response: 'yes' },
      actor: member,
    });

    await request(`/workspaces/${workspace.id}/meetings/${meetingId}`, {
      method: 'PATCH',
      payload: { startsAt: soon(5) },
      actor: owner,
    });

    const listed = await request(`/workspaces/${workspace.id}/meetings`, { actor: owner });
    const attendees = listed.json().meetings[0].attendees;

    // "Yes" meant yes to a particular time, so it does not survive the move.
    const theirs = attendees.find((a: { userId: string }) => a.userId === member.id);
    expect(theirs.response).toBe('pending');

    // The organiser's own answer is left alone -- they did the moving.
    const mine = attendees.find((a: { userId: string }) => a.userId === owner.id);
    expect(mine.response).toBe('yes');
  });

  test('a member cannot reschedule a meeting they did not organise', async () => {
    const owner = await createActor('Owner');
    const member = await createActor('Member');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, member, 'MEMBER');

    const created = await request(`/workspaces/${workspace.id}/meetings`, {
      method: 'POST',
      payload: { title: 'Owned by owner', startsAt: soon() },
      actor: owner,
    });

    const response = await request(
      `/workspaces/${workspace.id}/meetings/${created.json().meeting.id}`,
      { method: 'PATCH', payload: { title: 'Hijacked' }, actor: member },
    );

    expect(response.statusCode).toBe(403);
  });

  test('cancelling keeps the row and drops it from upcoming', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    const created = await request(`/workspaces/${workspace.id}/meetings`, {
      method: 'POST',
      payload: { title: 'Called off', startsAt: soon() },
      actor: owner,
    });

    const cancelled = await request(
      `/workspaces/${workspace.id}/meetings/${created.json().meeting.id}`,
      { method: 'DELETE', actor: owner },
    );
    expect(cancelled.statusCode).toBe(204);

    const upcoming = await request(`/workspaces/${workspace.id}/meetings`, { actor: owner });
    expect(upcoming.json().meetings).toHaveLength(0);

    // Still there, marked -- a meeting that merely vanishes tells the people
    // who planned around it nothing.
    const past = await request(`/workspaces/${workspace.id}/meetings?scope=past`, {
      actor: owner,
    });
    expect(past.json().meetings).toHaveLength(1);
    expect(past.json().meetings[0].canceledAt).not.toBeNull();
  });

  test('a cancelled meeting cannot be answered or edited', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    const created = await request(`/workspaces/${workspace.id}/meetings`, {
      method: 'POST',
      payload: { title: 'Gone', startsAt: soon() },
      actor: owner,
    });
    const meetingId = created.json().meeting.id;

    await request(`/workspaces/${workspace.id}/meetings/${meetingId}`, {
      method: 'DELETE',
      actor: owner,
    });

    const answered = await request(`/workspaces/${workspace.id}/meetings/${meetingId}/response`, {
      method: 'POST',
      payload: { response: 'yes' },
      actor: owner,
    });
    expect(answered.statusCode).toBe(409);

    const edited = await request(`/workspaces/${workspace.id}/meetings/${meetingId}`, {
      method: 'PATCH',
      payload: { title: 'Back on' },
      actor: owner,
    });
    expect(edited.statusCode).toBe(409);
  });

  test('a meeting id from another workspace is not found', async () => {
    const owner = await createActor('Owner');
    const outsider = await createActor('Outsider');
    const theirs = await createWorkspace(owner);
    const mine = await createWorkspace(outsider);

    const created = await request(`/workspaces/${theirs.id}/meetings`, {
      method: 'POST',
      payload: { title: 'Private', startsAt: soon() },
      actor: owner,
    });

    const response = await request(
      `/workspaces/${mine.id}/meetings/${created.json().meeting.id}`,
      { method: 'PATCH', payload: { title: 'Peeked' }, actor: outsider },
    );

    expect(response.statusCode).toBe(404);
  });
});
