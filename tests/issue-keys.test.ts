import { describe, expect, test } from 'bun:test';
import { discussDraft, splitIssueKeys } from '@robis/web/lib/issue-keys.ts';

const PROJECTS = new Set(['REL', 'API']);

describe('issue keys in chat', () => {
  test('a known key becomes a link part, the rest stays text', () => {
    expect(splitIssueKeys('Can you look at REL-4 today?', PROJECTS)).toEqual([
      { text: 'Can you look at ' },
      { key: 'REL-4' },
      { text: ' today?' },
    ]);
  });

  test('several keys, in any case, at the edges too', () => {
    expect(splitIssueKeys('rel-4, API-12 and REL-7', PROJECTS)).toEqual([
      { key: 'REL-4' },
      { text: ', ' },
      { key: 'API-12' },
      { text: ' and ' },
      { key: 'REL-7' },
    ]);
  });

  test('a prefix that is not one of the workspace’s projects stays text', () => {
    expect(splitIssueKeys('COVID-19 and B-52', PROJECTS)).toEqual([{ text: 'COVID-19 and B-52' }]);
  });

  test('a key inside a longer word or number is not a key', () => {
    expect(splitIssueKeys('XREL-4 REL-4x REL-40', PROJECTS)).toEqual([
      { text: 'XREL-4 REL-4x ' },
      { key: 'REL-40' },
    ]);
  });

  test('leading zeros are read as the number they are', () => {
    expect(splitIssueKeys('REL-007', PROJECTS)).toEqual([{ key: 'REL-7' }]);
  });

  test('with no projects, or no text, nothing is split', () => {
    expect(splitIssueKeys('REL-4', new Set())).toEqual([{ text: 'REL-4' }]);
    expect(splitIssueKeys('', PROJECTS)).toEqual([{ text: '' }]);
  });

  test('the Discuss draft is the key and a space', () => {
    expect(discussDraft('REL-4')).toBe('REL-4 ');
  });
});
