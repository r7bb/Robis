import { describe, expect, test } from 'bun:test';
import { isNudgeKind, NUDGE_GUIDES, NUDGE_KINDS, SAMPLE_DOCUMENT_BODY } from '@robis/shared';
import { EMPTY_VIEW_KEYS, EMPTY_VIEWS, guideHref } from '@robis/web/lib/empty-views.ts';

/**
 * Empty views (C5): each says what goes there and offers the one thing that
 * fills it, reusing the nudge guides' words where a guide covers the same
 * ground.
 */

const DASHES = /[–—]/;

describe('empty views', () => {
  test('every view says what goes there, as a sentence, with no dashes', () => {
    for (const key of EMPTY_VIEW_KEYS) {
      const { title, body, action } = EMPTY_VIEWS[key];
      expect(title.length).toBeGreaterThan(0);
      expect(body).toMatch(/[.!]$/);
      expect(`${title} ${body} ${action?.label ?? ''}`).not.toMatch(DASHES);
    }
  });

  test('a view with a guide explains itself in the guide’s own words', () => {
    for (const key of EMPTY_VIEW_KEYS) {
      const { guide, body } = EMPTY_VIEWS[key];
      if (!guide) continue;
      expect(isNudgeKind(guide)).toBe(true);
      expect(body).toBe(NUDGE_GUIDES[guide].summary);
    }
  });

  test('every view that can be filled here has exactly one action', () => {
    // Meetings is the exception on purpose: its button sits just above.
    const withoutAction = EMPTY_VIEW_KEYS.filter((key) => !EMPTY_VIEWS[key].action);
    expect(withoutAction).toEqual(['meetings']);
  });

  test('every view is shown somewhere', async () => {
    const sources: string[] = [];
    for await (const path of new Bun.Glob('frontend/{app,components,features}/**/*.tsx').scan()) {
      sources.push(await Bun.file(path).text());
    }
    const all = sources.join('\n');
    for (const key of EMPTY_VIEW_KEYS) expect(all).toContain(`view="${key}"`);
  });

  test('a guide link carries the workspace when there is one', () => {
    expect(guideHref('create_issue')).toBe('/guide/create_issue');
    expect(guideHref('create_issue', 'a b')).toBe('/guide/create_issue?w=a%20b');
  });
});

describe('the nudge guides the views reuse', () => {
  test('have no dashes in their copy', () => {
    for (const kind of NUDGE_KINDS) {
      const guide = NUDGE_GUIDES[kind];
      const text = [
        guide.title,
        guide.summary,
        ...guide.steps,
        guide.note ?? '',
        guide.action.label,
      ];
      expect(text.join(' ')).not.toMatch(DASHES);
    }
    expect(SAMPLE_DOCUMENT_BODY).not.toMatch(DASHES);
  });

  test('no longer say inviting is by email only or by API only', () => {
    const invite = NUDGE_GUIDES.invite_teammate;
    const text = [...invite.steps, invite.note ?? ''].join(' ');
    expect(text).toContain('username');
    expect(text).not.toContain('API-only');
  });
});
