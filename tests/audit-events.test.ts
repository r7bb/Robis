import { describe, expect, test } from 'bun:test';
import { describeEvent } from '../frontend/lib/audit-events.ts';

/** Every event type the API writes. Kept in step with `tests/audit.test.ts`. */
const WRITTEN = [
  'workspace.created',
  'workspace.updated',
  'project.created',
  'project.updated',
  'project.deleted',
  'issue.created',
  'issue.status_changed',
  'issue.updated',
  'issue.deleted',
  'comment.created',
  'comment.deleted',
  'document.created',
  'document.updated',
  'document.deleted',
  'channel.created',
  'channel.updated',
  'channel.deleted',
  'message.deleted',
  'meeting.created',
  'meeting.updated',
  'meeting.responded',
  'meeting.canceled',
  'member.added',
  'member.role_changed',
  'member.removed',
  'member.left',
];

describe('describing audit events', () => {
  test('every event the API writes reads as a sentence, even with an empty payload', () => {
    for (const type of WRITTEN) {
      const sentence = describeEvent(type, {});
      expect(sentence).not.toBe(type);
      expect(sentence).not.toContain('undefined');
    }
  });

  test('moderation reads differently from retracting your own words', () => {
    expect(describeEvent('comment.deleted', { moderated: true })).toBe("removed someone's comment");
    expect(describeEvent('comment.deleted', { moderated: false })).toBe('deleted a comment');
  });

  test('an unknown type is shown as itself rather than dropped', () => {
    expect(describeEvent('agent.invented', {})).toBe('agent.invented');
    // Not fooled by names that exist on every object.
    expect(describeEvent('toString', {})).toBe('toString');
  });

  test('a status move names both ends', () => {
    expect(
      describeEvent('issue.status_changed', { key: 'WEB-4', from: 'IN_REVIEW', to: 'DONE' }),
    ).toBe('moved WEB-4 from in review to done');
  });
});
