'use client';

import { SAPHA_KEPT_DAYS, SAPHA_TURN_CHARS } from '@robis/shared';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { ago } from '../../../lib/time.ts';
import { useAssist } from '../../assist/use-assist.ts';
import { SaphaTurnView } from './sapha-turn.tsx';
import {
  aboutDraft,
  announced,
  hasQuestion,
  lastAsked,
  retryOf,
  startersAbout,
  stillAnswering,
} from './turn-model.ts';
import { useConversation, useConversations, useForget, useSay } from './use-sapha-chat.ts';

/** Ways in, for someone who has not asked Sapha anything yet. */
const QUIET =
  'rounded px-2 py-1 text-xs text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft';

/**
 * Sapha, the agent: a conversation at the side of any workspace page. It
 * looks things up as the person and answers; a change it proposes waits on
 * its card for Do it. Escape closes it; the conversation stays, kept for
 * 30 days, and History opens the earlier ones.
 */
export function SaphaPanel({
  workspaceId,
  firstWords,
  about,
  onClose,
}: {
  workspaceId: string;
  /** Words typed in the palette, asked as soon as the panel opens. */
  firstWords: string | null;
  /** The issue it was opened from, by key, named in the draft and the starters. */
  about: string | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { available, loaded } = useAssist(workspaceId);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showingHistory, setShowingHistory] = useState(false);
  // The palette's words, until asked: back from History, they are not asked again.
  const [unasked, setUnasked] = useState(firstWords);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    // Drawn before the dialog opened, the field could not take focus then: it takes it now.
    element?.querySelector<HTMLTextAreaElement>('textarea[name="sapha-message"]')?.focus();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-label="Sapha"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-y-0 right-0 m-0 ml-auto flex h-[100dvh] max-h-none w-[min(28rem,100vw)] flex-col border-l border-line bg-raised p-0 text-content shadow-2xl backdrop:bg-black/30"
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">Sapha</h2>
        <div className="flex items-center gap-1">
          {available ? (
            <>
              <button
                type="button"
                className={QUIET}
                onClick={() => {
                  setConversationId(null);
                  setShowingHistory(false);
                }}
              >
                New
              </button>
              <button
                type="button"
                aria-pressed={showingHistory}
                className={QUIET}
                onClick={() => setShowingHistory((was) => !was)}
              >
                History
              </button>
            </>
          ) : null}
          <button type="button" aria-label="Close Sapha" className={QUIET} onClick={onClose}>
            ×
          </button>
        </div>
      </header>
      {!loaded ? (
        <p className="p-4 text-sm text-faint">Looking…</p>
      ) : !available ? (
        <p className="p-4 text-sm text-muted">
          Sapha answers questions here once an admin turns on assistance for this workspace, in its
          settings. Requests typed in the command palette still work without it.
        </p>
      ) : showingHistory ? (
        <History
          workspaceId={workspaceId}
          onOpen={(id) => {
            setConversationId(id);
            setShowingHistory(false);
          }}
          onForgotten={() => setConversationId(null)}
        />
      ) : (
        <Conversation
          workspaceId={workspaceId}
          conversationId={conversationId}
          firstWords={unasked}
          onAsked={() => setUnasked(null)}
          about={about}
          onConversation={setConversationId}
          onNavigate={onClose}
        />
      )}
    </dialog>
  );
}

function Conversation({
  workspaceId,
  conversationId,
  firstWords,
  onAsked,
  about,
  onConversation,
  onNavigate,
}: {
  workspaceId: string;
  conversationId: string | null;
  firstWords: string | null;
  onAsked: () => void;
  about: string | null;
  onConversation: (id: string) => void;
  onNavigate: () => void;
}) {
  const conversation = useConversation(workspaceId, conversationId);
  const say = useSay(workspaceId, conversationId, onConversation);
  const [draft, setDraft] = useState(() => aboutDraft(about));
  const asked = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const turns = conversationId ? (conversation.data?.turns ?? []) : [];
  const answering = stillAnswering(turns) || say.isPending;
  // The latest answer failed: its question, to ask again.
  const again = retryOf(turns);

  // What was typed in the palette is asked once, as the panel opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked once, when opened with words.
  useEffect(() => {
    if (firstWords && !asked.current) {
      asked.current = true;
      onAsked();
      say.mutate(firstWords);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolled to the newest turn as each one comes.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [turns.length, answering]);

  function send(text: string) {
    const words = text.trim();
    if (!hasQuestion(words, about) || answering) return;
    say.mutate(words, { onSuccess: () => setDraft('') });
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {turns.length === 0 && !say.isPending ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Ask about the work here, or ask for a change. Sapha looks things up as you, and
              anything it would change waits for your Do it.
            </p>
            <ul className="space-y-1.5">
              {startersAbout(about).map((starter) => (
                <li key={starter}>
                  <button
                    type="button"
                    onClick={() => send(starter)}
                    className={`${QUIET} text-left`}
                  >
                    {starter}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="space-y-4">
            {turns.map((turn, i) => (
              <SaphaTurnView
                key={turn.id}
                workspaceId={workspaceId}
                turn={turn}
                onNavigate={onNavigate}
                onRetry={
                  again !== null && i === turns.length - 1 && !answering
                    ? () => send(again)
                    : undefined
                }
              />
            ))}
            {say.isPending && !stillAnswering(turns) ? (
              <li className="mr-8 text-sm text-faint" aria-busy="true">
                Sapha is looking…
              </li>
            ) : null}
          </ol>
        )}
        {/* One short line for screen readers, rather than the whole list read again. */}
        <p role="status" className="sr-only">
          {say.isPending && !stillAnswering(turns) ? 'Sapha is looking.' : announced(turns)}
        </p>
        <div ref={end} />
      </div>
      <Composer
        draft={draft}
        onDraft={setDraft}
        answering={answering}
        canSend={hasQuestion(draft, about)}
        recall={lastAsked(turns)}
        error={say.isError ? (say.error as Error).message : null}
        onSend={() => send(draft)}
      />
    </>
  );
}

function Composer({
  draft,
  onDraft,
  answering,
  canSend,
  recall,
  error,
  onSend,
}: {
  draft: string;
  onDraft: (text: string) => void;
  answering: boolean;
  /** Something asked, beyond the issue's name typed for them. */
  canSend: boolean;
  /** The last question asked here, brought back by Up in the empty field. */
  recall: string | null;
  error: string | null;
  onSend: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  // Opened with first words, the caret waits after them, kept when the panel focuses the field.
  useEffect(() => {
    const end = field.current?.value.length ?? 0;
    field.current?.setSelectionRange(end, end);
  }, []);
  function submit(event: FormEvent) {
    event.preventDefault();
    onSend();
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSend();
    } else if (event.key === 'ArrowUp' && !draft && recall) {
      // Up in an empty field brings back the last question, to change and ask again.
      event.preventDefault();
      onDraft(recall);
      requestAnimationFrame(() => field.current?.setSelectionRange(recall.length, recall.length));
    }
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-1.5 border-t border-line px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
    >
      {error ? (
        <p role="alert" className="text-xs text-danger-soft">
          {error}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          // biome-ignore lint/a11y/noAutofocus: the panel was opened to type into
          autoFocus
          ref={field}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={SAPHA_TURN_CHARS}
          name="sapha-message"
          aria-label="Ask Sapha"
          placeholder="Ask Sapha…"
          autoComplete="off"
          className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-content placeholder:text-faint focus:border-accent-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        />
        <button
          type="submit"
          disabled={!canSend || answering}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50"
        >
          Ask
        </button>
      </div>
      <p className="text-[11px] text-faint">
        Uses the assistant, which reads what it looks up. Kept {SAPHA_KEPT_DAYS} days.
      </p>
    </form>
  );
}

function History({
  workspaceId,
  onOpen,
  onForgotten,
}: {
  workspaceId: string;
  onOpen: (id: string) => void;
  onForgotten: () => void;
}) {
  const list = useConversations(workspaceId, true);
  const forget = useForget(workspaceId, onForgotten);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState<string | null>(null);
  const rows = list.data?.conversations ?? [];
  return (
    <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
      {list.isPending ? <p className="text-sm text-faint">Looking…</p> : null}
      {list.isSuccess && rows.length === 0 ? (
        <p className="text-sm text-muted">No conversations yet.</p>
      ) : null}
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2 py-1.5">
            <button
              type="button"
              onClick={() => onOpen(row.id)}
              className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
            >
              <span className="block truncate text-sm text-content">{row.title}</span>
              <time
                dateTime={row.updatedAt}
                title={new Date(row.updatedAt).toLocaleString()}
                className="block text-[11px] text-faint"
              >
                {ago(row.updatedAt)}
              </time>
            </button>
            {clearing === row.id ? (
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted">
                Clear it?
                <button
                  type="button"
                  // biome-ignore lint/a11y/noAutofocus: the safe choice takes focus as the question appears
                  autoFocus
                  className={QUIET}
                  onClick={() => {
                    setClearing(null);
                    refocus(`[data-clear="${row.id}"]`);
                  }}
                >
                  Keep
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-1 text-xs font-medium text-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
                  onClick={() => {
                    forget.mutate(row.id);
                    setClearing(null);
                  }}
                >
                  Clear
                </button>
              </span>
            ) : (
              <button
                type="button"
                aria-label={`Clear the conversation ${row.title}`}
                data-clear={row.id}
                onClick={() => setClearing(row.id)}
                className={QUIET}
              >
                Clear
              </button>
            )}
          </li>
        ))}
      </ul>
      {rows.length > 0 ? (
        confirming ? (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
            Clear every conversation with Sapha here, for good?
            <button
              type="button"
              // biome-ignore lint/a11y/noAutofocus: the safe choice takes focus as the question appears
              autoFocus
              className={QUIET}
              onClick={() => {
                setConfirming(false);
                refocus('[data-clear-all]');
              }}
            >
              Keep them
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 text-xs font-medium text-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
              onClick={() => {
                forget.mutate('all');
                setConfirming(false);
              }}
            >
              Clear all
            </button>
          </p>
        ) : (
          <button
            type="button"
            data-clear-all
            className={QUIET}
            onClick={() => setConfirming(true)}
          >
            Clear all…
          </button>
        )
      ) : null}
      {forget.isError ? (
        <p role="alert" className="text-xs text-danger-soft">
          {(forget.error as Error).message}
        </p>
      ) : null}
    </div>
  );
}

/** Focus the button the panel draws back once a question closes, so the keyboard keeps its place. */
function refocus(selector: string) {
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>(`dialog[open] ${selector}`)?.focus(),
  );
}
