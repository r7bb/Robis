import { DEFAULT_LOCALE, formatTag, type Locale } from './locales.ts';

/**
 * Dates, times and numbers in the viewer's locale (C9). One tag for the
 * whole page, set by the locale provider when it knows the viewer's
 * choice; every formatter reads it, so a change of language reformats
 * everything on the next render. Formatters are kept per tag and options,
 * since building an Intl formatter is the slow part.
 */

let activeTag = formatTag(DEFAULT_LOCALE, []);

export function setFormatLocale(locale: Locale, browser: readonly string[]) {
  activeTag = formatTag(locale, browser);
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();

export function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${activeTag}|${JSON.stringify(options)}`;
  let found = dateFormats.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(activeTag, options);
    dateFormats.set(key, found);
  }
  return found;
}

/** A calendar day, "2026-12-06", said in the reader's language: "Sun 6 Dec". */
export function dayLine(day: string): string {
  return dateFormat({ weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(`${day}T12:00`),
  );
}

function numberFormat(options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${activeTag}|${JSON.stringify(options)}`;
  let found = numberFormats.get(key);
  if (!found) {
    found = new Intl.NumberFormat(activeTag, options);
    numberFormats.set(key, found);
  }
  return found;
}

/** A date and time in full, for tooltips: "24 Nov 2026, 09:30". */
export const formatDateTime = (value: string | Date) =>
  dateFormat({ dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

/** A calendar date: "24 Nov 2026". */
export const formatDate = (value: string | Date) =>
  dateFormat({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));

/** A time of day: "09:30" or "9:30 AM", as the locale writes it. */
export const formatClock = (value: string | Date) =>
  dateFormat({ hour: 'numeric', minute: '2-digit' }).format(new Date(value));

export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) =>
  numberFormat(options).format(value);

/** "in 3 days", "yesterday", in the locale's words. */
export function formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  return new Intl.RelativeTimeFormat(activeTag, { numeric: 'auto' }).format(value, unit);
}
