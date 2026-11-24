import { describe, expect, test } from 'bun:test';
import { followUpsIn, markFollowUp } from '@robis/shared';

/**
 * Follow-ups in meeting notes: checklist lines, and lines starting TODO or
 * Action, each one a possible issue; once made, its line carries the key
 * and is done, so it is never made twice.
 */

const NOTES = [
  'Retro, 24 Nov',
  '',
  '- [ ] Send the budget to finance',
  '* [x] Book the room',
  'TODO: Fix the flaky export test',
  'Action: Ana to draft the release notes',
  '- [ ] Ship the hotfix (REL-12)',
  'We agreed the deploy window stays at four.',
].join('\n');

describe('follow-ups in notes', () => {
  test('checklist, TODO and Action lines, with whether each is done and its key', () => {
    expect(followUpsIn(NOTES)).toEqual([
      { line: 2, text: 'Send the budget to finance', done: false, key: null },
      { line: 3, text: 'Book the room', done: true, key: null },
      { line: 4, text: 'Fix the flaky export test', done: false, key: null },
      { line: 5, text: 'Ana to draft the release notes', done: false, key: null },
      { line: 6, text: 'Ship the hotfix', done: true, key: 'REL-12' },
    ]);
  });

  test('nothing but prose has none', () => {
    expect(followUpsIn('We talked about the roadmap.\nNo decisions.')).toEqual([]);
    expect(followUpsIn('')).toEqual([]);
  });

  test('marking one done puts its key on its line and leaves the rest as written', () => {
    const marked = markFollowUp(NOTES, 2, 'OPS-4');
    expect(marked.split('\n')[2]).toBe('- [x] Send the budget to finance (OPS-4)');
    expect(marked.split('\n').filter((_, i) => i !== 2)).toEqual(
      NOTES.split('\n').filter((_, i) => i !== 2),
    );
    expect(followUpsIn(marked)[0]).toMatchObject({ done: true, key: 'OPS-4' });
    // A TODO line becomes a ticked checklist line too.
    expect(markFollowUp(NOTES, 4, 'OPS-5').split('\n')[4]).toBe(
      '- [x] Fix the flaky export test (OPS-5)',
    );
  });

  test('a line that is not a follow-up, or no longer there, is left alone', () => {
    expect(markFollowUp(NOTES, 0, 'OPS-1')).toBe(NOTES);
    expect(markFollowUp(NOTES, 99, 'OPS-1')).toBe(NOTES);
  });
});
