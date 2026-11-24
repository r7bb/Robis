import type { Locale } from './locales.ts';
import { en, type MessageKey } from './messages/en.ts';
import { es } from './messages/es.ts';

/**
 * Looking a string up (C9): the viewer's language, else English, with
 * `{name}` placeholders filled. Pure, so it is tested without a browser.
 */

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, es };

export type Vars = Readonly<Record<string, string | number>>;

/** The keys of plural pairs, without their `.one` or `.other`. */
export type PluralKey = MessageKey extends infer K
  ? K extends `${infer Base}.other`
    ? Base
    : never
  : never;

function fill(text: string, vars: Vars | undefined, numbers: (n: number) => string): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    if (value === undefined) return whole;
    return typeof value === 'number' ? numbers(value) : value;
  });
}

export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Vars,
  numbers: (n: number) => string = String,
): string {
  return fill(MESSAGES[locale][key] ?? en[key], vars, numbers);
}

/** A count in words, picked by the language's own plural rules. */
export function translatePlural(
  locale: Locale,
  key: PluralKey,
  count: number,
  vars?: Vars,
  numbers: (n: number) => string = String,
): string {
  const form = new Intl.PluralRules(locale).select(count) === 'one' ? 'one' : 'other';
  return translate(locale, `${key}.${form}` as MessageKey, { count, ...vars }, numbers);
}
