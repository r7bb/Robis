import { dateFormat } from './i18n/format.ts';

/**
 * How a due day reads (C1): relative while it is near, a date once it is
 * not, and marked when it has passed. Days are calendar days, compared as
 * `YYYY-MM-DD` strings, so there is no time of day or zone to get wrong.
 */

export type DueTone = 'overdue' | 'soon' | 'later' | 'done';

const DAY_MS = 86_400_000;
/** Within this many days ahead, a due day reads as "in N days". */
const SOON_DAYS = 6;

/** Today on the viewer's own calendar, as `YYYY-MM-DD`. */
export function localToday(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`; negative when `to` is earlier. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function shortDate(day: string): string {
  return dateFormat({ day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

/**
 * The words for a due day, and how loudly to show them. Work that is done
 * or cancelled is never overdue: its date is shown, quietly.
 */
export function describeDue(
  dueOn: string,
  today: string,
  finished = false,
): { text: string; tone: DueTone } {
  if (finished) return { text: `Due ${shortDate(dueOn)}`, tone: 'done' };
  const days = daysBetween(today, dueOn);
  if (days < 0) {
    const late = -days;
    return { text: `Overdue by ${late} ${late === 1 ? 'day' : 'days'}`, tone: 'overdue' };
  }
  if (days === 0) return { text: 'Due today', tone: 'soon' };
  if (days === 1) return { text: 'Due tomorrow', tone: 'soon' };
  if (days <= SOON_DAYS) return { text: `Due in ${days} days`, tone: 'soon' };
  return { text: `Due ${shortDate(dueOn)}`, tone: 'later' };
}
