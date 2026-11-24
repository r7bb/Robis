'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { call } from '../../lib/api.ts';
import { dateFormat } from '../../lib/i18n/format.ts';
import { issueHref } from '../../lib/links.ts';
import type { Question } from './use-sapha-command.ts';

const FINISHED = new Set(['DONE', 'CANCELED']);
const STATUS_NAMES: Record<string, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
  CANCELED: 'Canceled',
};

/** Everything an answer about one issue needs, read with the asker's access. */
async function readIssue(workspaceId: string, issueKey: string) {
  const { issue: found } = await call(contracts['issues.byKey'], {
    params: { workspaceId, key: issueKey },
  }).catch(() => {
    throw new Error(`No issue ${issueKey} here.`);
  });
  const [{ issue }, blocks, { members }] = await Promise.all([
    call(contracts['issues.get'], { params: { workspaceId, issueId: found.id } }),
    call(contracts['issues.blocks'], { params: { workspaceId, issueId: found.id } }),
    call(contracts['members.list'], { params: { workspaceId } }),
  ]);
  const assignee = members.find((m) => m.userId === issue.assigneeId)?.name ?? null;
  return { issue, waiting: blocks.blockedBy, assignee };
}

type Read = Awaited<ReturnType<typeof readIssue>>;

/** "In progress · with Ana · due Fri 27 Nov · urgent". */
function standing({ issue, assignee }: Read): string {
  const due = issue.dueOn
    ? `due ${dateFormat({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${issue.dueOn}T12:00`))}`
    : '';
  return [
    STATUS_NAMES[issue.status] ?? issue.status,
    assignee ? `with ${assignee}` : 'nobody has it',
    due,
    issue.priority === 'URGENT' || issue.priority === 'HIGH' ? issue.priority.toLowerCase() : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Sapha answers a question about an issue in the palette: how it stands
 * (its status, who has it, when it is due) and what it waits on, each
 * blocker a link and finished ones struck through.
 */
export function SaphaAnswer({
  workspaceId,
  question,
  onBack,
  onClose,
}: {
  workspaceId: string;
  question: Question;
  onBack: () => void;
  onClose: () => void;
}) {
  const { issueKey } = question;
  const answer = useQuery({
    queryKey: ['sapha-answer', workspaceId, issueKey],
    queryFn: () => readIssue(workspaceId, issueKey),
    retry: false,
  });
  const read = answer.data;
  const open = read?.waiting.filter((b) => !FINISHED.has(b.status)) ?? [];

  return (
    <section
      aria-label="Sapha"
      className="space-y-3 p-4"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onBack();
      }}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Sapha</p>
      {answer.isPending ? <p className="text-sm text-faint">Looking…</p> : null}
      {answer.isError ? (
        <p role="alert" className="text-sm text-danger-soft">
          {(answer.error as Error).message}
        </p>
      ) : null}
      {read ? (
        <div role="status" className="space-y-2">
          {question.kind === 'about' ? (
            <>
              <p className="text-base text-content">
                <span className="mr-1.5 font-mono text-sm text-faint">{issueKey}</span>
                {read.issue.title}
              </p>
              <p className="text-sm text-muted">{standing(read)}</p>
            </>
          ) : null}
          <p
            className={question.kind === 'about' ? 'text-sm text-muted' : 'text-base text-content'}
          >
            {open.length === 0
              ? `${issueKey} is not waiting on anything.`
              : `${issueKey} waits on ${open.length === 1 ? 'one issue' : `${open.length} issues`}:`}
          </p>
          {read.waiting.length > 0 ? (
            <ul className="space-y-1">
              {read.waiting.map((blocker) => (
                <li key={blocker.id} className="text-sm">
                  <Link
                    href={issueHref(workspaceId, blocker.id)}
                    onClick={onClose}
                    className={`hover:underline ${FINISHED.has(blocker.status) ? 'text-faint line-through' : 'text-content'}`}
                  >
                    <span className="mr-1.5 font-mono text-xs text-faint">{blocker.key}</span>
                    {blocker.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <Link
            href={issueHref(workspaceId, read.issue.id)}
            onClick={onClose}
            className="inline-block text-sm text-accent-soft hover:underline"
          >
            Open {issueKey}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
