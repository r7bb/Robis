'use client';

import { contracts } from '@robis/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import { call } from '../../lib/api.ts';
import { discussDraft } from '../../lib/issue-keys.ts';
import { PEEK_PARAM, withParam } from '../../lib/links.ts';
import { useCoalesced } from '../../lib/realtime.ts';
import { concernsIssue } from '../../lib/realtime-events.ts';
import { useChatControls } from '../workspace/chat-controls.tsx';
import { useLiveEvents } from '../workspace/live.tsx';
import { IssueDetail } from './issue-detail.tsx';

/**
 * Open and close the peek: an issue over the board, without leaving it.
 * The issue is in the address, so a peek is a link, a reload keeps it,
 * and Back closes it.
 */
export function usePeek() {
  const router = useRouter();
  const pathname = usePathname();
  const peeked = useSearchParams().get(PEEK_PARAM);
  const open = useCallback(
    (issueId: string) => {
      if (issueId === peeked || !mayLeave()) return;
      router.push(withParam(pathname, window.location.search, PEEK_PARAM, issueId), {
        scroll: false,
      });
    },
    [router, pathname, peeked],
  );
  const close = useCallback(() => {
    if (!mayLeave()) return false;
    router.replace(withParam(pathname, window.location.search, PEEK_PARAM, null), {
      scroll: false,
    });
    return true;
  }, [router, pathname]);
  return { peeked, open, close };
}

/**
 * A comment not yet sent or a description being edited is lost when the
 * peek shows another issue or closes, so the person is asked first.
 */
function mayLeave(): boolean {
  const unsaved = document.querySelector('[data-peek] [data-unsaved="true"]');
  return !unsaved || window.confirm('Leave this issue? What you were writing is not saved.');
}

/** A dialog over the page (a confirmation, an image) takes Escape for itself. */
function dialogAbove(target: HTMLElement | null): boolean {
  if (target?.closest('[aria-modal="true"], dialog[open]')) return true;
  return document.querySelector('[aria-modal="true"], dialog[open]') !== null;
}

/** The card the peek came from, to give focus back to. */
function cardOf(issueId: string) {
  return document.querySelector<HTMLElement>(`[data-card="${CSS.escape(issueId)}"]`);
}

/**
 * The peek itself: the issue in a sheet over the right of the board, with a
 * way to its own page. The board stays usable beside it, so choosing another
 * card shows that one instead. Escape or the close button shuts it and puts
 * focus back on the card.
 */
export function IssuePeek() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { peeked, close } = usePeek();
  const queryClient = useQueryClient();
  const sheet = useRef<HTMLElement>(null);

  // The frame's connection hears this issue while it is peeked.
  const refresh = useCoalesced(() => {
    if (!peeked) return;
    queryClient.invalidateQueries({ queryKey: ['issue', workspaceId, peeked] });
    queryClient.invalidateQueries({ queryKey: ['comments', workspaceId, peeked] });
  });
  const shut = useCallback(() => {
    const from = peeked;
    if (close() && from) requestAnimationFrame(() => cardOf(from)?.focus());
  }, [close, peeked]);

  useLiveEvents((event) => {
    if (!peeked || !concernsIssue(event, peeked)) return;
    // Deleted by someone else: there is nothing left to show.
    if (event.type === 'issue.deleted') shut();
    else refresh();
  });

  // Into the sheet on opening, and Escape shuts it unless something inside
  // (a menu, a field being edited) used the key first.
  useEffect(() => {
    if (!peeked) return;
    sheet.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      // A field being typed in, or a dialog above, uses Escape first.
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (dialogAbove(target)) return;
      event.preventDefault();
      shut();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [peeked, shut]);

  if (!peeked) return null;

  return (
    <section
      ref={sheet}
      role="dialog"
      aria-label="Issue"
      data-peek
      tabIndex={-1}
      className="absolute inset-y-0 right-0 z-20 flex w-full max-w-2xl flex-col border-l border-line bg-surface shadow-2xl shadow-black/30 outline-none"
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
        <IssueDetail
          key={peeked}
          workspaceId={workspaceId}
          issueId={peeked}
          onDeleted={shut}
          showKey
          toolbar={
            <>
              <DiscussButton issueId={peeked} />
              <Link
                href={`/workspaces/${workspaceId}/issues/${peeked}`}
                className="rounded-md px-1.5 py-1 text-xs text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
              >
                Open as page
              </Link>
              <button
                type="button"
                onClick={shut}
                aria-label="Close the issue"
                title="Close (Esc)"
                className="rounded-md px-2 py-1 text-sm leading-none text-muted transition-colors hover:bg-raised hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
              >
                ×
              </button>
            </>
          }
        />
      </div>
    </section>
  );
}

/** Start a message about the peeked issue in the chat beside it. */
function DiscussButton({ issueId }: { issueId: string }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const chat = useChatControls();
  // The same query the detail below makes, so this costs nothing extra.
  const issue = useQuery({
    queryKey: ['issue', workspaceId, issueId],
    queryFn: () => call(contracts['issues.get'], { params: { workspaceId, issueId } }),
  });
  const key = issue.data?.issue.key;
  if (!chat || !key) return null;
  return (
    <button
      type="button"
      onClick={() => chat.discuss(discussDraft(key))}
      className="rounded-md border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-raised hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
    >
      Discuss
    </button>
  );
}
