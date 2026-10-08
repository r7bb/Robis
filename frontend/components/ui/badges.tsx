import type { IssuePriority, IssueStatus } from '@robis/shared';

/**
 * Colour that carries information.
 *
 * The board used to paint every priority the same amber, so `LOW` and
 * `URGENT` were visually identical and the colour meant nothing except
 * "this row has a priority". Worse, it was the same amber as the "Unsynced"
 * badge, which does mean something, so the one signal on the card competed
 * with four non-signals.
 *
 * These hues are literal rather than themed, for the reason the danger
 * colour already is: red means the same thing in every workspace, and a red
 * that shifts with the theme is a red nobody learns to read.
 */

type Style = { label: string; className: string };

/** Ascending urgency, so the eye can sort a column without reading it. */
const PRIORITY_STYLES: Record<IssuePriority, Style | null> = {
  // Rendered as nothing: "nobody has triaged this" is the absence of a
  // priority, and giving it a badge would make the common case the loudest.
  NONE: null,
  LOW: { label: 'Low', className: 'border-slate-400/30 bg-slate-400/10 text-slate-300' },
  MEDIUM: { label: 'Medium', className: 'border-sky-400/30 bg-sky-400/10 text-sky-300' },
  HIGH: { label: 'High', className: 'border-amber-400/35 bg-amber-400/10 text-amber-300' },
  URGENT: { label: 'Urgent', className: 'border-rose-400/40 bg-rose-400/15 text-rose-300' },
};

const STATUS_STYLES: Record<IssueStatus, { label: string; dot: string; text: string }> = {
  TODO: { label: 'Todo', dot: 'bg-slate-400', text: 'text-slate-300' },
  IN_PROGRESS: { label: 'In Progress', dot: 'bg-sky-400', text: 'text-sky-300' },
  IN_REVIEW: { label: 'In Review', dot: 'bg-violet-400', text: 'text-violet-300' },
  DONE: { label: 'Done', dot: 'bg-emerald-400', text: 'text-emerald-300' },
  CANCELED: { label: 'Canceled', dot: 'bg-slate-600', text: 'text-faint' },
};

export function PriorityBadge({ priority }: { priority: IssuePriority }) {
  const style = PRIORITY_STYLES[priority];
  if (!style) return null;

  return (
    <span
      className={`rounded-full border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ${style.className}`}
    >
      {style.label}
    </span>
  );
}

/** The heading of a board column: a coloured dot, a name, and a count. */
export function StatusHeading({ status, count }: { status: IssueStatus; count: number }) {
  const style = STATUS_STYLES[status];

  return (
    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
      {/* Decorative: the column name beside it already says which status
          this is, so a screen reader would only hear it twice. */}
      <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden="true" />
      <span className={style.text}>{style.label}</span>
      <span className="font-normal normal-case tracking-normal text-faint">{count}</span>
    </h2>
  );
}

export function StatusBadge({ status }: { status: IssueStatus }) {
  const style = STATUS_STYLES[status];

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
      <span className={style.text}>{style.label}</span>
    </span>
  );
}

export function statusLabel(status: IssueStatus): string {
  return STATUS_STYLES[status].label;
}
