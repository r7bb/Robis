'use client';

import { useT } from '../../lib/i18n/locale-context.tsx';
import { LOCALE_NAMES, LOCALES, type Locale } from '../../lib/i18n/locales.ts';

/**
 * Choosing the language (C9): one of the languages Robis has, or the
 * browser's. Kept in this browser; nothing about it is sent to the server.
 */
export function LanguagePicker() {
  const { t, chosen, choose } = useT();
  return (
    <div>
      <p className="max-w-[60ch] text-sm text-muted">{t('account.languageLead')}</p>
      <label className="mt-3 block text-xs font-medium text-muted">
        {t('account.language')}
        <select
          value={chosen ?? ''}
          onChange={(event) => choose((event.target.value || null) as Locale | null)}
          className="mt-1 block w-full max-w-xs rounded-md border border-line bg-raised px-3 py-2 text-sm text-content outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <option value="">{t('account.languageFollow')}</option>
          {LOCALES.map((locale) => (
            <option key={locale} value={locale} lang={locale}>
              {LOCALE_NAMES[locale]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
