import { describe, expect, test } from 'bun:test';
import { hitHref, kindFromParam, searchHref } from '@robis/web/lib/search-links.ts';

/** Where search leads (C1): each result's page, and the results page itself. */

const WS = 'ws-1';

describe('search links', () => {
  test('a document opens itself, an issue or a comment opens the issue', () => {
    expect(hitHref(WS, { kind: 'document', id: 'd1', issueId: null })).toBe(
      '/workspaces/ws-1/documents/d1',
    );
    expect(hitHref(WS, { kind: 'issue', id: 'i1', issueId: 'i1' })).toBe(
      '/workspaces/ws-1/issues/i1',
    );
    expect(hitHref(WS, { kind: 'comment', id: 'c1', issueId: 'i1' })).toBe(
      '/workspaces/ws-1/issues/i1',
    );
  });

  test('the results page carries the query and the kind, encoded', () => {
    expect(searchHref(WS, '  token & "refresh" ')).toBe(
      '/workspaces/ws-1/search?q=token+%26+%22refresh%22',
    );
    expect(searchHref(WS, 'token', 'comment')).toBe('/workspaces/ws-1/search?q=token&type=comment');
    expect(searchHref(WS, '')).toBe('/workspaces/ws-1/search');
  });

  test('an unknown kind in the address means every kind', () => {
    expect(kindFromParam('issue')).toBe('issue');
    expect(kindFromParam('meeting')).toBeNull();
    expect(kindFromParam(null)).toBeNull();
  });
});
