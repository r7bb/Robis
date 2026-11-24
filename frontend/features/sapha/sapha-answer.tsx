'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { call } from '../../lib/api.ts';
import { issueHref } from '../../lib/links.ts';

const FINISHED = new Set(['DONE', 'CANCELED']);

/**
 * Sapha answers a question in the palette: what an issue waits on, from its
 * Blocked by, each one a link, the ones finished struck through. Read with
 * the person's own access, as the issue page would.
 */
export function SaphaAnswer({
  workspaceId,
  issueKey,
  onBack,
  onClose,
}: {
  workspaceId: string;
  issueKey: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const answer = useQuery({
    queryKey: ['sapha-blockers', workspaceId, issueKey],
    queryFn: async () => {
      const { issue } = await call(contracts['issues.byKey'], {
        params: { workspaceId, key: issueKey },
      }).catch(() => {
        throw new Error(`No issue ${issueKey} here.`);
      });
      const blocks = await call(contracts['issues.blocks'], {
        params: { workspaceId, issueId: issue.id },
      });
      return { issue, waiting: blocks.blockedBy };
    },
    retry: false,
  });
  const open = answer.data?.waiting.filter((b) => !FINISHED.has(b.status)) ?? [];

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
      {answer.data ? (
        <div role="status" className="space-y-2">
          <p className="text-base text-content">
            {open.length === 0
              ? `${issueKey} is not waiting on anything.`
              : `${issueKey} waits on ${open.length === 1 ? 'one issue' : `${open.length} issues`}:`}
          </p>
          {answer.data.waiting.length > 0 ? (
            <ul className="space-y-1">
              {answer.data.waiting.map((blocker) => (
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
            href={issueHref(workspaceId, answer.data.issue.id)}
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
