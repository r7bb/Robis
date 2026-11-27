'use client';

import { describeIntent, type SaphaCited, type SaphaTurn } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { issueHref } from '../../../lib/links.ts';
import { useMyId } from '../../../lib/use-people.ts';
import { runIntent } from '../run-intent.ts';
import { type Change, changesOf, linkIssues, sourcesOf } from './turn-model.ts';

/**
 * One turn in a conversation with Sapha: what was asked, or the answer with
 * what Sapha looked at, its words (only issues it looked at linked) and a
 * card for each change it proposes, made only on Do it, as the person.
 */
export function SaphaTurnView({
  workspaceId,
  turn,
  onNavigate,
  onRetry,
}: {
  workspaceId: string;
  turn: SaphaTurn;
  onNavigate: () => void;
  /** Ask the same question again: offered on the latest answer only, when it failed. */
  onRetry?: () => void;
}) {
  if (turn.role === 'person') {
    return (
      <li className="ml-8 rounded-lg bg-accent/15 px-3 py-2 text-sm text-content">
        <p className="whitespace-pre-wrap break-words">{turn.text}</p>
      </li>
    );
  }
  if (turn.status === 'pending') {
    return (
      <li className="mr-8 text-sm text-faint" aria-busy="true">
        Sapha is looking…
      </li>
    );
  }
  if (turn.status === 'failed') {
    return (
      <li className="mr-8 space-y-1.5 text-sm">
        <p className="text-danger-soft">{turn.text}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-line px-2.5 py-1 text-xs text-content transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            Try again
          </button>
        ) : null}
      </li>
    );
  }
  const changes = changesOf(turn.proposals, new Date());
  return (
    <li className="mr-8 space-y-2">
      {turn.steps.length > 0 ? (
        <p className="text-[11px] text-faint">{turn.steps.join(' · ')}</p>
      ) : null}
      <p className="whitespace-pre-wrap break-words text-sm text-content">
        {linkIssues(turn.text, turn.issues).map((segment, i) =>
          'issue' in segment ? (
            <Link
              // biome-ignore lint/suspicious/noArrayIndexKey: a segment's place is its identity
              key={i}
              href={issueHref(workspaceId, segment.issue.id)}
              onClick={onNavigate}
              title={segment.issue.title}
              className="font-medium text-accent-soft hover:underline"
            >
              {segment.text}
            </Link>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: a segment's place is its identity
            <span key={i}>{segment.text}</span>
          ),
        )}
      </p>
      <AnswerFooter
        workspaceId={workspaceId}
        text={turn.text}
        cited={turn.issues}
        onNavigate={onNavigate}
      />
      {changes.length > 0 ? (
        <ul className="space-y-2">
          {changes.map((change, i) => (
            <ChangeCard
              // biome-ignore lint/suspicious/noArrayIndexKey: a proposal's place is its identity
              key={i}
              workspaceId={workspaceId}
              change={change}
              doneKey={`${turn.id}.${i}`}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** How long Copy says Copied before it reads Copy again. */
const COPIED_MS = 2000;

/**
 * Under an answer: the issues it drew on, as links, so each claim can be
 * checked at its source, and Copy for the words.
 */
function AnswerFooter({
  workspaceId,
  text,
  cited,
  onNavigate,
}: {
  workspaceId: string;
  text: string;
  cited: readonly SaphaCited[];
  onNavigate: () => void;
}) {
  const { shown, more } = sourcesOf(cited);
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
      {shown.length > 0 ? (
        <>
          <span>Looked at</span>
          {shown.map((issue) => (
            <Link
              key={issue.id}
              href={issueHref(workspaceId, issue.id)}
              onClick={onNavigate}
              title={issue.title}
              className="rounded font-mono text-muted hover:text-content hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
            >
              {issue.key}
            </Link>
          ))}
          {more > 0 ? <span>and {more} more</span> : null}
        </>
      ) : null}
      <button
        type="button"
        onClick={copy}
        className="ml-auto rounded px-1.5 py-0.5 text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      >
        <span aria-live="polite">
          {copied === 'yes' ? 'Copied' : copied === 'failed' ? 'Could not copy' : 'Copy'}
        </span>
      </button>
    </div>
  );
}

/** Which cards were done, kept in this browser only, so a reload does not offer one twice. */
const DONE_KEY = 'robis.sapha.done';

function wasDone(key: string): boolean {
  try {
    return localStorage.getItem(`${DONE_KEY}.${key}`) === '1';
  } catch {
    return false;
  }
}

function markDone(key: string) {
  try {
    localStorage.setItem(`${DONE_KEY}.${key}`, '1');
  } catch {
    // Private mode or full storage: the card may be offered again, nothing worse.
  }
}

/** A change Sapha proposes: said in full, and made only on Do it. */
function ChangeCard({
  workspaceId,
  change,
  doneKey,
  onNavigate,
}: {
  workspaceId: string;
  change: Change;
  /** This card, among every card Sapha has shown here. */
  doneKey: string;
  onNavigate: () => void;
}) {
  const queryClient = useQueryClient();
  const myId = useMyId();
  const [declined, setDeclined] = useState(false);
  const [doneBefore] = useState(() => wasDone(doneKey));
  const run = useMutation({
    mutationFn: () => runIntent(workspaceId, change, myId),
    onSuccess: () => {
      markDone(doneKey);
      return queryClient.invalidateQueries();
    },
  });
  if (doneBefore && !run.isSuccess) {
    return <li className="text-xs text-faint">Done: {describeIntent(change)}</li>;
  }
  if (declined) {
    return <li className="text-xs text-faint">Left as it was: {describeIntent(change)}</li>;
  }
  return (
    <li className="rounded-lg border border-line bg-surface p-3">
      <p className="text-sm text-content">{describeIntent(change)}</p>
      {run.isSuccess ? (
        <p role="status" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          {run.data.said}
          {run.data.href ? (
            <Link
              href={run.data.href}
              onClick={onNavigate}
              className="text-accent-soft hover:underline"
            >
              Open
            </Link>
          ) : null}
        </p>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={run.isPending}
            onClick={() => run.mutate()}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-contrast hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50"
          >
            Do it
          </button>
          <button
            type="button"
            onClick={() => setDeclined(true)}
            className="rounded px-1.5 py-1 text-xs text-faint hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            Not now
          </button>
          {run.isError ? (
            <p role="alert" className="text-xs text-danger-soft">
              {(run.error as Error).message}
            </p>
          ) : null}
        </div>
      )}
    </li>
  );
}
