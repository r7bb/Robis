import type { contracts, ResponseOf } from '@robis/shared';

/** What an .ics import did (B8), as the meetings page says it. */

export type ImportResult = ResponseOf<(typeof contracts)['meetings.import']>;

/** What happened, in one or two sentences. */
export function importSummary(result: ImportResult): string {
  const made = result.created.length;
  const first =
    made === 0
      ? 'Nothing was imported.'
      : `Imported ${made} ${made === 1 ? 'meeting' : 'meetings'}.`;
  const people = result.attendeesLeftOff
    ? ' The people named in the file were not added: only admins can match addresses to people.'
    : '';
  if (result.skipped.length === 0) return `${first}${people}`;
  const left = result.skipped
    .slice(0, 3)
    .map((skip) => (skip.title ? `${skip.title} (${skip.reason})` : skip.reason))
    .join('; ');
  const more = result.skipped.length > 3 ? `, and ${result.skipped.length - 3} more` : '';
  return `${first} Left out: ${left}${more}.${people}`;
}
