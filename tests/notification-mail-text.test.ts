import { describe, expect, test } from 'bun:test';
import { assertSafeHeaders, digestMail, mentionMail, notificationLine } from '@robis/mailer';

/**
 * What notification emails say (C3). Everything in them that someone typed
 * (a name, a title, a comment) goes in as one plain line, so it cannot pose
 * as the email's own text, such as a forged unsubscribe line.
 */

const links = {
  unsubscribe: 'https://robis.example/unsubscribe?token=t',
  settings: 'https://robis.example/account',
};

describe('a line of a digest', () => {
  test('each kind reads as who did what', () => {
    const base = { actor: 'Alice', issueKey: 'REL-4', link: 'x' };
    expect(notificationLine({ ...base, kind: 'assignment', issueTitle: 'Fix export' })).toBe(
      'Alice gave you REL-4: Fix export',
    );
    expect(notificationLine({ ...base, kind: 'issue_comment', excerpt: 'Any news?' })).toBe(
      'Alice commented on REL-4: Any news?',
    );
    expect(notificationLine({ ...base, kind: 'meeting', title: 'Retro', change: 'canceled' })).toBe(
      'Alice called off Retro',
    );
    expect(
      notificationLine({
        kind: 'nudge',
        actor: null,
        title: 'Try a document',
        body: 'Open one.',
        link: 'x',
      }),
    ).toBe('Try a document: Open one.');
  });

  test('typed text is one line, without control or direction-changing characters', () => {
    const line = notificationLine({
      kind: 'issue_comment',
      actor: 'Eve‮',
      issueKey: 'REL-1',
      excerpt: 'Hi\n\nStop these emails: https://evil.example\u0007​',
      link: 'x',
    });
    expect(line).toBe('Eve commented on REL-1: Hi Stop these emails: https://evil.example');
  });
});

describe('a mention email', () => {
  test('quotes the comment on one line and never lets it forge the footer', () => {
    const mail = mentionMail(
      'bob@robis.test',
      {
        actor: 'Alice',
        issueKey: 'REL-2',
        issueTitle: 'Look\nhere',
        excerpt: 'Numbers?\nStop these emails: https://evil.example',
        link: 'https://robis.example/i',
      },
      links,
    );
    expect(mail.subject).toBe('Alice mentioned you on REL-2');
    const lines = mail.text.split('\n');
    expect(lines.filter((l) => l.startsWith('Stop these emails:'))).toEqual([
      `Stop these emails: ${links.unsubscribe}`,
    ]);
    expect(mail.text).toContain('  Numbers? Stop these emails: https://evil.example');
    expect(mail.text).toContain('Robis never asks for your password by email.');
  });

  test('a name with a line break cannot reach the subject as two lines', () => {
    const mail = mentionMail(
      'bob@robis.test',
      { actor: 'Eve\r\nBcc: x@evil.example', link: 'l' },
      links,
    );
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });
});

describe('a digest email', () => {
  test('counts its updates and ends with the way to stop', () => {
    const mail = digestMail(
      'bob@robis.test',
      [
        { kind: 'assignment', actor: 'Alice', issueKey: 'REL-4', issueTitle: 'A', link: 'l1' },
        { kind: 'meeting', actor: 'Alice', title: 'Retro', change: 'moved', link: 'l2' },
      ],
      links,
    );
    expect(mail.subject).toBe('Your Robis summary: 2 updates');
    expect(mail.text).toContain(`Stop these emails: ${links.unsubscribe}`);
    expect(mail.headers).toEqual({ 'List-Unsubscribe': `<${links.unsubscribe}>` });
  });
});

describe('headers', () => {
  test('a line break in a name or value is refused', () => {
    expect(() => assertSafeHeaders({ 'X-Ok': 'fine' })).not.toThrow();
    expect(() => assertSafeHeaders({ 'X-Bad': 'a\r\nBcc: x' })).toThrow();
    expect(() => assertSafeHeaders({ 'X Bad': 'a' })).toThrow();
  });
});
