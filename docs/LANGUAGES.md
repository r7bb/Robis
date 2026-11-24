# Languages

Robis speaks English and Spanish (C9). The viewer gets the language they
chose under Account, Language; otherwise the first of their browser's
languages that Robis has; otherwise English. Dates, times and numbers
follow the browser's own regional form within that language, so an
American reader still sees the month first.

## Where the words live

- `frontend/lib/i18n/messages/en.ts`: every string that has moved, keyed
  by where it is used. `{name}` is filled in when shown; a pair ending in
  `.one` and `.other` is chosen by the language's own plural rules.
- `frontend/lib/i18n/messages/es.ts`: the same keys in Spanish. Written
  during the build and not yet read by a native speaker.
- `frontend/lib/i18n/format.ts`: the only place dates, times and numbers
  are formatted. Nothing else calls `Intl` or `toLocaleString`.

The app shell, the calendar, Spaces and the language picker are in the
message files. Other screens still hold their English in place; each moves
the same way, a key at a time, and a screen half moved still reads, since a
missing translation falls back to English.

## Adding a language

1. Add its code to `LOCALES` and its own name to `LOCALE_NAMES` in
   `frontend/lib/i18n/locales.ts`, with a fallback region.
2. Copy `es.ts` to the new code and translate every value. The type
   refuses a file with a key missing, and `tests/i18n.test.ts` refuses one
   whose placeholders differ from the English.
3. Register it in `MESSAGES` in `frontend/lib/i18n/translate.ts`.

## Using it in a component

```tsx
const { t, plural } = useT();
t('calendar.week', { number: 48 }); // "Week 48", "Semana 48"
plural('calendar.meetings', count); // "1 meeting", "3 meetings"
```
