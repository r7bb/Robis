'use client';

import { SAPHA_KEPT_DAYS, SAPHA_TURN_CHARS } from '@robis/shared';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { ago } from '../../../lib/time.ts';
import { useAssist } from '../../assist/use-assist.ts';
import { SaphaTurnView } from './sapha-turn.tsx';
import { stillAnswering } from './turn-model.ts';
import { useConversation, useConversations, useForget, useSay } from './use-sapha-chat.ts';

/** Ways in, for someone who has not asked Sapha anything yet. */
const STARTERS = [
  'What is on my plate today?',
  'What keeps slipping?',
  'Which releases are coming up?',
];

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
  onClose,
}: {
  workspaceId: string;
  /** Words typed in the palette, asked as soon as the panel opens. */
  firstWords: string | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { available, loaded } = useAssist(workspaceId);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showingHistory, setShowingHistory] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
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
          firstWords={firstWords}
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
  onConversation,
  onNavigate,
}: {
  workspaceId: string;
  conversationId: string | null;
  firstWords: string | null;
  onConversation: (id: string) => void;
  onNavigate: () => void;
}) {
  const conversation = useConversation(workspaceId, conversationId);
  const say = useSay(workspaceId, conversationId, onConversation);
  const [draft, setDraft] = useState('');
  const asked = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const turns = conversationId ? (conversation.data?.turns ?? []) : [];
  const answering = stillAnswering(turns) || say.isPending;

  // What was typed in the palette is asked once, as the panel opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked once, when opened with words.
  useEffect(() => {
    if (firstWords && !asked.current) {
      asked.current = true;
      say.mutate(firstWords);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolled to the newest turn as each one comes.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [turns.length, answering]);

  function send(text: string) {
    const words = text.trim();
    if (!words || answering) return;
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
              {STARTERS.map((starter) => (
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
          <ol aria-live="polite" className="space-y-4">
            {turns.map((turn) => (
              <SaphaTurnView
                key={turn.id}
                workspaceId={workspaceId}
                turn={turn}
                onNavigate={onNavigate}
              />
            ))}
            {say.isPending && !stillAnswering(turns) ? (
              <li className="mr-8 text-sm text-faint" aria-busy="true">
                Sapha is looking…
              </li>
            ) : null}
          </ol>
        )}
        <div ref={end} />
      </div>
      <Composer
        draft={draft}
        onDraft={setDraft}
        answering={answering}
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
  error,
  onSend,
}: {
  draft: string;
  onDraft: (text: string) => void;
  answering: boolean;
  error: string | null;
  onSend: () => void;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onSend();
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSend();
    }
  }
  return (
    <form onSubmit={submit} className="space-y-1.5 border-t border-line px-4 py-3">
      {error ? (
        <p role="alert" className="text-xs text-danger-soft">
          {error}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          // biome-ignore lint/a11y/noAutofocus: the panel was opened to type into
          autoFocus
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={SAPHA_TURN_CHARS}
          name="sapha-message"
          aria-label="Ask Sapha"
          placeholder="Ask Sapha…"
          autoComplete="off"
          className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-content placeholder:text-faint focus:border-accent-soft focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim() || answering}
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
              <span className="block text-[11px] text-faint">{ago(row.updatedAt)}</span>
            </button>
            {clearing === row.id ? (
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted">
                Clear it?
                <button type="button" className={QUIET} onClick={() => setClearing(null)}>
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
            <button type="button" className={QUIET} onClick={() => setConfirming(false)}>
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
          <button type="button" className={QUIET} onClick={() => setConfirming(true)}>
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
