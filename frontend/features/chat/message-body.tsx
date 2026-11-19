'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { call } from '../../lib/api.ts';
import { splitIssueKeys } from '../../lib/issue-keys.ts';
import { boardHref, PEEK_PARAM, withParam } from '../../lib/links.ts';

/**
 * A message's text, with each issue key in it (REL-4) a link that opens
 * the issue over its board. Text only, never markup: a message is the most
 * attacker-controlled string in the product, so it is split, not parsed.
 */
export function MessageBody({ workspaceId, body }: { workspaceId: string; body: string }) {
  const projects = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => call(contracts['projects.list'], { params: { workspaceId } }),
    staleTime: 60_000,
  });
  const prefixes = useMemo(
    () => new Set((projects.data?.projects ?? []).map((project) => project.key.toUpperCase())),
    [projects.data],
  );
  const parts = splitIssueKeys(body, prefixes);

  return (
    <>
      {parts.map((part, index) =>
        'key' in part ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one message never reorder
          <IssueKeyLink key={index} workspaceId={workspaceId} issueKey={part.key} />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one message never reorder
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** One key: looked up when pressed, then the issue opens over its board. */
function IssueKeyLink({ workspaceId, issueKey }: { workspaceId: string; issueKey: string }) {
  const router = useRouter();
  const [missing, setMissing] = useState(false);

  async function open() {
    try {
      const { issue } = await call(contracts['issues.byKey'], {
        params: { workspaceId, key: issueKey },
      });
      router.push(withParam(boardHref(workspaceId, issue.projectId), '', PEEK_PARAM, issue.id));
    } catch {
      // Deleted since it was written, or never there: say so where it is.
      setMissing(true);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      title={missing ? `${issueKey} is not an issue here any more` : `Open ${issueKey}`}
      className={`rounded px-1 font-mono text-[0.85em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
        missing ? 'text-faint line-through' : 'bg-accent/15 text-accent-soft hover:bg-accent/25'
      }`}
    >
      {issueKey}
    </button>
  );
}
