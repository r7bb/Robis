import { describe, expect, test } from 'bun:test';
import type { ServerEvent } from '@robis/shared';
import {
  describeEvent,
  feedItemFrom,
  greetingFor,
  othersHere,
} from '@robis/web/features/home/describe.ts';

/**
 * The signed-in home's plain logic: what a live event says in the feed,
 * who counts as "here now", and the greeting. The page itself is checked
 * in Chrome (`bun run smoke:browser`).
 */

const WS = '00000000-0000-4000-8000-000000000001';
const ISSUE = '00000000-0000-4000-8000-000000000002';

const issueCreated: ServerEvent = {
  type: 'issue.created',
  workspaceId: WS,
  projectId: 'p',
  issueId: ISSUE,
  actorId: 'mia',
};

describe('a live event in the feed', () => {
  test('says who did what, by name when the name is known', () => {
    expect(describeEvent(issueCreated, 'Mia')).toBe('Mia opened an issue');
    expect(describeEvent({ ...issueCreated, type: 'comment.created' }, 'Alex')).toBe(
      'Alex commented on an issue',
    );
    expect(describeEvent(issueCreated, null)).toBe('A teammate opened an issue');
  });

  test('leaves out messages, which may be in a private channel, and noise', () => {
    const message = {
      type: 'message.created',
      workspaceId: WS,
      channelId: 'c',
      messageId: 'm',
      actorId: 'mia',
    } as unknown as ServerEvent;
    expect(describeEvent(message, 'Mia')).toBeNull();
    expect(
      describeEvent(
        { type: 'attachment.changed', workspaceId: WS, issueId: ISSUE, actorId: 'mia' },
        'Mia',
      ),
    ).toBeNull();
  });

  test('links an issue event to the issue, anything else to the workspace', () => {
    const item = feedItemFrom(issueCreated, {
      actorName: 'Mia',
      workspaceName: 'Engineering',
      at: 1,
    });
    expect(item).toMatchObject({
      text: 'Mia opened an issue',
      workspaceName: 'Engineering',
      href: `/workspaces/${WS}/issues/${ISSUE}`,
    });
    const project = feedItemFrom(
      { type: 'project.created', workspaceId: WS, projectId: 'p', actorId: 'mia' },
      { actorName: 'Mia', workspaceName: 'Engineering', at: 2 },
    );
    expect(project?.href).toBe(`/workspaces/${WS}`);
    // Two events in the same millisecond still get their own keys.
    expect(item?.id).not.toBe(project?.id);
  });
});

describe('who is here now', () => {
  test('counts each other person once across workspaces, never you', () => {
    const here = othersHere('me', [
      [
        { userId: 'me', name: 'Me', location: null },
        { userId: 'mia', name: 'Mia', location: null },
      ],
      [
        { userId: 'mia', name: 'Mia', location: 'p' },
        { userId: 'alex', name: 'Alex', location: null },
      ],
    ]);
    expect(here.map((user) => user.userId).sort()).toEqual(['alex', 'mia']);
  });
});

test('the greeting follows the time of day', () => {
  expect(greetingFor(8)).toBe('Good morning');
  expect(greetingFor(14)).toBe('Good afternoon');
  expect(greetingFor(21)).toBe('Good evening');
  expect(greetingFor(2)).toBe('Good evening');
});
