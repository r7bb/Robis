import { describe, expect, test } from 'bun:test';
import { describeNotification, notificationHref } from '@robis/web/lib/notification-text.ts';

/** What the inbox says for each kind (C3), and where it leads. */

const item = (
  kind: string,
  payload: Record<string, unknown> = {},
  actorName: string | null = 'Alice',
) => ({
  kind,
  workspaceId: 'ws',
  actorName,
  payload,
});

describe('the wording', () => {
  test('a mention and a comment name the issue and quote the comment', () => {
    expect(describeNotification(item('mention', { issueKey: 'REL-2', excerpt: 'Look' }))).toEqual({
      actor: 'Alice',
      did: 'mentioned you',
      subject: 'REL-2',
      body: 'Look',
    });
    expect(
      describeNotification(item('issue_comment', { issueKey: 'REL-2', excerpt: 'Hm' })).did,
    ).toBe('commented on');
  });

  test('an assignment names the issue and its title', () => {
    expect(
      describeNotification(item('assignment', { issueKey: 'REL-4', issueTitle: 'Fix export' })),
    ).toEqual({ actor: 'Alice', did: 'gave you', subject: 'REL-4', body: 'Fix export' });
  });

  test('a meeting says what happened to it', () => {
    expect(describeNotification(item('meeting', { title: 'Retro', change: 'moved' })).did).toBe(
      'moved',
    );
    expect(describeNotification(item('meeting', { title: 'Retro', change: 'canceled' })).did).toBe(
      'called off',
    );
    expect(describeNotification(item('meeting', { title: 'Retro' })).subject).toBe('Retro');
  });

  test('someone gone is still someone', () => {
    expect(describeNotification(item('assignment', {}, null)).actor).toBe('Someone');
  });
});

describe('where it leads', () => {
  test('an issue, or else the workspace', () => {
    expect(notificationHref(item('assignment', { issueId: 'i1' }))).toBe(
      '/workspaces/ws/issues/i1',
    );
    expect(notificationHref(item('meeting', { title: 'Retro' }))).toBe('/workspaces/ws');
    expect(notificationHref({ ...item('meeting'), workspaceId: null })).toBe('/workspaces');
  });
});
