'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { formatNumber, setFormatLocale } from './format.ts';
import { DEFAULT_LOCALE, isLocale, type Locale, resolveLocale } from './locales.ts';
import type { MessageKey } from './messages/en.ts';
import { type PluralKey, translate, translatePlural, type Vars } from './translate.ts';

/**
 * The viewer's language for the whole app (C9). The choice is kept in this
 * browser, like the theme of the page around it, and the page's `lang`
 * follows it so a screen reader reads in the right voice. Until the browser
 * is read (the first render, and on the server), English.
 */

const CHOICE_KEY = 'robis-locale';

type LocaleState = {
  locale: Locale;
  /** The language chosen on the account page, or null to follow the browser. */
  chosen: Locale | null;
  choose: (locale: Locale | null) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  plural: (key: PluralKey, count: number, vars?: Vars) => string;
};

const LocaleContext = createContext<LocaleState | null>(null);

function readChoice(): Locale | null {
  try {
    const stored = window.localStorage.getItem(CHOICE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writeChoice(locale: Locale | null) {
  try {
    if (locale) window.localStorage.setItem(CHOICE_KEY, locale);
    else window.localStorage.removeItem(CHOICE_KEY);
  } catch {
    // Storage refused (a private window): the choice lasts this visit.
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [chosen, setChosen] = useState<Locale | null>(null);
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);

  const apply = useCallback((choice: Locale | null) => {
    const browser = navigator.languages ?? [navigator.language];
    const next = resolveLocale(choice, browser);
    setFormatLocale(next, browser);
    document.documentElement.lang = next;
    setChosen(choice);
    setLocale(next);
  }, []);

  useEffect(() => apply(readChoice()), [apply]);

  const value = useMemo<LocaleState>(
    () => ({
      locale,
      chosen,
      choose: (choice) => {
        writeChoice(choice);
        apply(choice);
      },
      t: (key, vars) => translate(locale, key, vars, (n) => formatNumber(n)),
      plural: (key, count, vars) =>
        translatePlural(locale, key, count, vars, (n) => formatNumber(n)),
    }),
    [locale, chosen, apply],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Words in the viewer's language; English outside the provider, as in tests. */
export function useT(): LocaleState {
  const state = useContext(LocaleContext);
  if (state) return state;
  return {
    locale: DEFAULT_LOCALE,
    chosen: null,
    choose: () => undefined,
    t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
    plural: (key, count, vars) => translatePlural(DEFAULT_LOCALE, key, count, vars),
  };
}
