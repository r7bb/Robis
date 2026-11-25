import { afterEach, describe, expect, test } from 'bun:test';
import { dayLabel, weekTitle } from '@robis/web/features/calendar/week-model.ts';
import { dayLine, formatDate, formatNumber, setFormatLocale } from '@robis/web/lib/i18n/format.ts';
import { formatTag, resolveLocale } from '@robis/web/lib/i18n/locales.ts';
import { en, type MessageKey } from '@robis/web/lib/i18n/messages/en.ts';
import { es } from '@robis/web/lib/i18n/messages/es.ts';
import { translate, translatePlural } from '@robis/web/lib/i18n/translate.ts';

/**
 * Languages (C9): every message file has every key English has, with the
 * same placeholders and the house rules; the viewer gets their chosen
 * language, else their browser's, else English; and dates and numbers
 * follow the viewer's locale.
 */

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const keys = Object.keys(en) as MessageKey[];

afterEach(() => setFormatLocale('en', []));

describe('the message files', () => {
  test('Spanish has every key, and only those', () => {
    expect(Object.keys(es).sort()).toEqual([...keys].sort());
  });

  test('each translation keeps the placeholders of the English', () => {
    for (const key of keys) {
      expect({ key, held: placeholders(es[key]) }).toEqual({ key, held: placeholders(en[key]) });
    }
  });

  test('plural pairs come whole, and nothing is empty or uses a long dash', () => {
    for (const key of keys) {
      if (key.endsWith('.one'))
        expect(keys).toContain(key.replace(/\.one$/, '.other') as MessageKey);
      for (const text of [en[key], es[key]]) {
        expect(text.trim().length).toBeGreaterThan(0);
        expect(/[–—]/.test(text)).toBe(false);
      }
    }
  });
});

describe('which language', () => {
  test('the choice first, then the browser’s first that Robis has, then English', () => {
    expect(resolveLocale('es', ['en-GB'])).toBe('es');
    expect(resolveLocale(null, ['fr-FR', 'es-MX', 'en'])).toBe('es');
    expect(resolveLocale(null, ['de', 'fr'])).toBe('en');
    expect(resolveLocale('klingon', [])).toBe('en');
  });

  test('formats in the browser’s own region for that language, else a fallback', () => {
    expect(formatTag('en', ['en-US', 'es'])).toBe('en-US');
    expect(formatTag('es', ['en-US', 'es-MX'])).toBe('es-MX');
    expect(formatTag('es', ['en-US'])).toBe('es-ES');
    expect(formatTag('en', [])).toBe('en-GB');
  });
});

describe('words', () => {
  test('fills placeholders and falls back to English outside a provider', () => {
    expect(translate('en', 'calendar.week', { number: 48 })).toBe('Week 48');
    expect(translate('es', 'calendar.week', { number: 48 })).toBe('Semana 48');
  });

  test('picks the plural form by the language’s rules', () => {
    expect(translatePlural('en', 'calendar.meetings', 1)).toBe('1 meeting');
    expect(translatePlural('en', 'calendar.meetings', 3)).toBe('3 meetings');
    expect(translatePlural('es', 'calendar.meetings', 1)).toBe('1 reunión');
    expect(translatePlural('es', 'calendar.meetings', 0)).toBe('0 reuniones');
  });
});

describe('dates and numbers in the viewer’s locale', () => {
  test('a date, a number and the calendar follow the chosen locale', () => {
    const day = { year: 2026, month: 11, day: 24, hour: 0, minute: 0 };
    const days = Array.from({ length: 7 }, (_, i) => ({ ...day, day: 23 + i }));
    expect(formatNumber(1234.5)).toBe('1,234.5');
    expect(weekTitle(days)).toBe('November 2026');

    setFormatLocale('es', ['es-ES']);
    expect(formatNumber(1234.5)).toBe('1234,5');
    expect(weekTitle(days)).toBe('noviembre de 2026');
    expect(dayLabel(day)).toContain('nov');
    expect(formatDate('2026-11-24T12:00:00Z')).toContain('nov');

    setFormatLocale('en', ['en-US']);
    expect(formatDate('2026-11-24T12:00:00Z')).toBe('Nov 24, 2026');
  });

  test('a calendar day said with its weekday, in the chosen locale', () => {
    setFormatLocale('en', ['en-GB']);
    expect(dayLine('2026-12-06')).toBe('Sun 6 Dec');
    setFormatLocale('es', ['es-ES']);
    expect(dayLine('2026-12-06')).toContain('dic');
  });
});
