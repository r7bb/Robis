/**
 * The languages Robis speaks (C9), and which one a viewer gets: the one they
 * chose on their account page, else the first of their browser's languages
 * Robis has, else English. Dates, times and numbers then follow the
 * browser's own regional form within that language (en-US keeps month
 * first, en-GB day first), so choosing English never changes how a date
 * reads to someone who already has it right.
 */

export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Each language named in itself, as a picker shows it. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', es: 'Español' };

/** The regional form used when the browser names none for the language. */
const FALLBACK_TAG: Record<Locale, string> = { en: 'en-GB', es: 'es-ES' };

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);

const languageOf = (tag: string) => tag.toLowerCase().split('-')[0] ?? '';

/** The language to show: the chosen one, else the browser's first that Robis has. */
export function resolveLocale(chosen: string | null, browser: readonly string[]): Locale {
  if (isLocale(chosen)) return chosen;
  for (const tag of browser) {
    const language = languageOf(tag);
    if (isLocale(language)) return language;
  }
  return DEFAULT_LOCALE;
}

/**
 * The BCP 47 tag to format with: the browser's own tag for that language
 * when it has one (en-US, es-MX), else the language's fallback.
 */
export function formatTag(locale: Locale, browser: readonly string[]): string {
  const own = browser.find((tag) => languageOf(tag) === locale);
  return own ?? FALLBACK_TAG[locale];
}
