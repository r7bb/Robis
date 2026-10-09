import { describe, expect, test } from 'bun:test';
import { parseMentions, resolveMentions, splitMentions } from '@robis/shared';

/**
 * Mention parsing decides who gets notified, so its failure modes are
 * asymmetric: missing a mention is an annoyance, inventing one sends someone
 * a notification about a conversation they were never part of.
 */
describe('parseMentions', () => {
  test('finds a simple mention', () => {
    expect(parseMentions('hey @rohit can you look')).toEqual(['rohit']);
  });

  test('finds several, in order, deduplicated', () => {
    expect(parseMentions('@ada and @grace, also @ada again')).toEqual(['ada', 'grace']);
  });

  test('is case-insensitive and normalises to lowercase', () => {
    expect(parseMentions('@Rohit and @ROHIT')).toEqual(['rohit']);
  });

  test('leaves trailing punctuation out of the handle', () => {
    expect(parseMentions('thanks @ada!')).toEqual(['ada']);
    expect(parseMentions('cc @ada, @grace.')).toEqual(['ada', 'grace']);
    expect(parseMentions('(@ada)')).toEqual(['ada']);
  });

  test('a mention at the very start counts', () => {
    expect(parseMentions('@ada ping')).toEqual(['ada']);
  });

  /**
   * The important negative case. An email in prose contains an `@`, and
   * treating its domain as a handle would notify whoever happens to share that
   * name.
   */
  test('an email address in prose is not a mention', () => {
    expect(parseMentions('write to ada@robis.test about it')).toEqual([]);
    expect(parseMentions('ada@robis.test')).toEqual([]);
  });

  test('a bare @ is not a mention', () => {
    expect(parseMentions('meet @ 5pm')).toEqual([]);
    expect(parseMentions('@')).toEqual([]);
  });

  test('handles inside words are ignored', () => {
    expect(parseMentions('foo@bar')).toEqual([]);
  });

  test('dots and hyphens inside a handle are kept', () => {
    expect(parseMentions('@ada.lovelace and @jean-luc')).toEqual(['ada.lovelace', 'jean-luc']);
  });

  test('empty and mention-free text yields nothing', () => {
    expect(parseMentions('')).toEqual([]);
    expect(parseMentions('no mentions here at all')).toEqual([]);
  });
});

describe('resolveMentions', () => {
  const members = [
    { id: 'u1', username: 'rohit' },
    { id: 'u2', username: 'ada' },
  ];

  test('resolves handles to members', () => {
    expect(resolveMentions('@rohit and @ada', members).map((m) => m.id)).toEqual(['u1', 'u2']);
  });

  test('unknown handles are dropped, not errors', () => {
    expect(resolveMentions('@nobody @rohit', members).map((m) => m.id)).toEqual(['u1']);
  });

  /**
   * Usernames are unique, so this needs stale or inconsistent data -- but if
   * it ever happens, guessing would notify the wrong person, which is worse
   * than notifying neither.
   */
  test('ambiguous handles are dropped rather than guessed', () => {
    const ambiguous = [
      { id: 'a', username: 'sam' },
      { id: 'b', username: 'Sam' },
    ];

    expect(resolveMentions('@sam look at this', ambiguous)).toEqual([]);
  });

  test('a handle is the username, never the email local part', () => {
    const people = [{ id: 'u3', username: 'grace_h' }];
    expect(resolveMentions('@grace please look', people)).toEqual([]);
    expect(resolveMentions('@grace_h please look', people).map((m) => m.id)).toEqual(['u3']);
  });

  test('an email in prose does not resolve to a member', () => {
    expect(resolveMentions('reply to ada@robis.test', members)).toEqual([]);
  });

  test('a member list that is empty resolves nothing', () => {
    expect(resolveMentions('@rohit', [])).toEqual([]);
  });
});

/**
 * The client highlights mentions using this split, and the worker notifies
 * using `parseMentions`. They used to be two regexes kept together by a
 * comment; these tests are what replaces the comment.
 */
describe('splitMentions', () => {
  test('reassembles into the original text', () => {
    for (const text of [
      '',
      'no mentions here',
      '@rohit at the start',
      'at the end @rohit',
      'hey @rohit and @ada, see ada@robis.test',
      '@@rohit',
      'thanks @ada!',
      'multi\nline @rohit text',
    ]) {
      expect(
        splitMentions(text)
          .map((s) => s.text)
          .join(''),
      ).toBe(text);
    }
  });

  test('tags mention runs and leaves the rest alone', () => {
    expect(splitMentions('hi @ada!')).toEqual([
      { text: 'hi ', handle: null },
      { text: '@ada', handle: 'ada' },
      { text: '!', handle: null },
    ]);
  });

  test('a mention at position zero produces no empty leading run', () => {
    expect(splitMentions('@ada hi')).toEqual([
      { text: '@ada', handle: 'ada' },
      { text: ' hi', handle: null },
    ]);
  });

  test('an email address is not split into a mention', () => {
    expect(splitMentions('write to ada@robis.test')).toEqual([
      { text: 'write to ada@robis.test', handle: null },
    ]);
  });

  /**
   * The property that matters: anything highlighted is notified, and anything
   * notified is highlighted. Drift between the two is the bug this prevents.
   */
  test('agrees with parseMentions on every sample', () => {
    for (const text of [
      'hey @rohit and @ada',
      'ada@robis.test is not @ada... or is it @ada',
      '@a @b @c @a',
      'thanks @ada! and @Rohit.',
      'nothing to see',
      '@ADA shouting',
    ]) {
      const fromSplit = [
        ...new Set(
          splitMentions(text)
            .map((s) => s.handle)
            .filter((h): h is string => h !== null),
        ),
      ];

      expect(fromSplit).toEqual(parseMentions(text));
    }
  });
});
