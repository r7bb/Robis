'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { call } from '../../lib/api.ts';
import { formatDay, formatTime } from '../../lib/time.ts';

/**
 * History: how the document read at moments while it changed, newest first.
 * Choosing one shows it whole; Put this back keeps the text there now as a
 * version, then writes the chosen one into the document as one edit, which
 * everyone editing sees and which can be undone the same way.
 */
export function DocumentHistory({
  workspaceId,
  documentId,
  current,
  canRestore,
  onRestore,
}: {
  workspaceId: string;
  documentId: string;
  /** The text as it stands, so a version that reads the same says so. */
  current: string;
  canRestore: boolean;
  onRestore: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  // What is there now is kept first, so putting a version back can be undone.
  const restore = useMutation({
    mutationFn: async (text: string) => {
      await call(contracts['documents.keepVersion'], { params: { workspaceId, documentId } });
      onRestore(text);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['document-versions', workspaceId, documentId] }),
  });
  const versions = useQuery({
    queryKey: ['document-versions', workspaceId, documentId],
    queryFn: () => call(contracts['documents.versions'], { params: { workspaceId, documentId } }),
    enabled: open,
  });
  const version = useQuery({
    queryKey: ['document-version', workspaceId, documentId, chosen],
    queryFn: () =>
      call(contracts['documents.version'], {
        params: { workspaceId, documentId, versionId: chosen! },
      }),
    enabled: chosen !== null,
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-2 py-1 text-xs text-muted hover:bg-raised hover:text-content"
      >
        History
      </button>
    );
  }

  const list = versions.data?.versions ?? [];
  const text = version.data?.version.text;
  return (
    <section
      aria-label="History"
      className="mt-4 grid gap-3 rounded-lg border border-line bg-raised p-3 sm:grid-cols-[14rem_1fr]"
    >
      <div className="min-w-0">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium text-muted">History</h2>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setChosen(null);
            }}
            className="text-xs text-faint hover:text-content"
          >
            Close
          </button>
        </div>
        {versions.isPending ? <p className="mt-2 text-xs text-faint">Loading…</p> : null}
        {!versions.isPending && list.length === 0 ? (
          <p className="mt-2 text-xs text-faint">
            Nothing kept yet. A version is kept as the document changes, at most one every ten
            minutes.
          </p>
        ) : null}
        <ul className="mt-2 max-h-72 space-y-0.5 overflow-y-auto">
          {list.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={chosen === item.id}
                onClick={() => setChosen(item.id)}
                className={`w-full rounded-md px-2 py-1.5 text-left transition-colors ${
                  chosen === item.id ? 'bg-accent/15' : 'hover:bg-surface'
                }`}
              >
                <span className="block text-xs text-content">
                  {formatDay(item.createdAt)}, {formatTime(item.createdAt)}
                </span>
                <span className="block truncate text-[11px] text-faint">
                  {item.preview || 'Empty'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <VersionView
        chosen={chosen !== null}
        text={text}
        current={current}
        canRestore={canRestore && !restore.isPending}
        onRestore={(text) => restore.mutate(text)}
      />
    </section>
  );
}

/** One version, whole, with Put this back when it differs from the document. */
function VersionView({
  chosen,
  text,
  current,
  canRestore,
  onRestore,
}: {
  chosen: boolean;
  text: string | undefined;
  current: string;
  canRestore: boolean;
  onRestore: (text: string) => void;
}) {
  if (!chosen) return <p className="text-xs text-faint">Choose a version to read it.</p>;
  if (text === undefined) return <p className="text-xs text-faint">Loading…</p>;
  return (
    <div className="min-w-0">
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface p-3 font-mono text-xs text-muted">
        {text || 'Empty'}
      </pre>
      <div className="mt-2 flex items-center gap-2">
        {text === current ? (
          <span className="text-xs text-faint">The document reads this way now.</span>
        ) : canRestore ? (
          <button
            type="button"
            onClick={() => onRestore(text)}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-contrast hover:bg-accent-hover"
          >
            Put this back
          </button>
        ) : (
          <span className="text-xs text-faint">Reconnecting; put it back once connected.</span>
        )}
      </div>
    </div>
  );
}
