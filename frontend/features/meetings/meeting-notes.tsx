'use client';

import {
  contracts,
  type FollowUp,
  followUpsIn,
  MEETING_NOTES_MAX_LENGTH,
  markFollowUp,
} from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { ApiError, call } from '../../lib/api.ts';
import { issueHref } from '../../lib/links.ts';

/**
 * A meeting's notes, opened from its card: read by anyone who may see the
 * meeting, written by whoever is in it. Checklist, TODO and Action lines are
 * follow-ups; Make an issue files one and ticks its line with the key, so
 * it is done once. A save over someone else's since is refused, with what
 * was written kept on screen to copy.
 */
export function MeetingNotes({
  workspaceId,
  meetingId,
}: {
  workspaceId: string;
  meetingId: string;
}) {
  const [open, setOpen] = useState(false);
  const fieldId = useId();
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-2 py-1 text-xs text-muted hover:bg-raised hover:text-content"
      >
        Notes
      </button>
    );
  }
  return (
    <NotesEditor
      workspaceId={workspaceId}
      meetingId={meetingId}
      fieldId={fieldId}
      onClose={() => setOpen(false)}
    />
  );
}

function useNotes(workspaceId: string, meetingId: string) {
  const queryClient = useQueryClient();
  const key = ['meeting-notes', workspaceId, meetingId];
  const notes = useQuery({
    queryKey: key,
    queryFn: () => call(contracts['meetings.notes'], { params: { workspaceId, meetingId } }),
  });
  const save = useMutation({
    mutationFn: (text: string) =>
      call(contracts['meetings.saveNotes'], {
        params: { workspaceId, meetingId },
        body: { notes: text, basedOn: notes.data?.updatedAt ?? null },
      }),
    onSuccess: (saved) => queryClient.setQueryData(key, saved),
  });
  return { notes, save, reload: () => queryClient.invalidateQueries({ queryKey: key }) };
}

function NotesEditor({
  workspaceId,
  meetingId,
  fieldId,
  onClose,
}: {
  workspaceId: string;
  meetingId: string;
  fieldId: string;
  onClose: () => void;
}) {
  const { notes, save, reload } = useNotes(workspaceId, meetingId);
  const [draft, setDraft] = useState<string | null>(null);
  const stored = notes.data?.notes ?? '';
  const text = draft ?? stored;
  const changed = draft !== null && draft !== stored;

  // Saved: the draft is the notes now.
  useEffect(() => {
    if (save.isSuccess) setDraft(null);
  }, [save.isSuccess]);

  if (notes.isPending) return <p className="mt-2 text-xs text-faint">Loading notes…</p>;
  if (notes.isError)
    return <p className="mt-2 text-xs text-danger-soft">Could not load the notes.</p>;
  const canEdit = notes.data.canEdit;

  return (
    <div className="mt-2 basis-full space-y-2 rounded-lg border border-line bg-raised p-3">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={fieldId} className="text-xs font-medium text-muted">
          Notes
        </label>
        <button type="button" onClick={onClose} className="text-xs text-faint hover:text-content">
          Close
        </button>
      </div>
      <textarea
        id={fieldId}
        value={text}
        readOnly={!canEdit}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={MEETING_NOTES_MAX_LENGTH}
        placeholder={
          canEdit ? 'What was said and agreed. “- [ ] Send the budget” makes a follow-up.' : ''
        }
        className="min-h-28 w-full resize-y rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-content outline-none placeholder:text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
      />
      <SaveBar
        canEdit={canEdit}
        changed={changed}
        saving={save.isPending}
        savedBy={notes.data.updatedAt ? (notes.data.updatedByName ?? 'someone') : null}
        error={save.error as Error | null}
        onSave={() => save.mutate(text)}
        onReload={() => void reload()}
      />
      <FollowUps
        workspaceId={workspaceId}
        notes={stored}
        items={followUpsIn(stored)}
        canFile={canEdit && !changed}
        onFiled={(marked) => save.mutate(marked)}
      />
    </div>
  );
}

/** Save, who saved last, and why a save was refused. */
function SaveBar({
  canEdit,
  changed,
  saving,
  savedBy,
  error,
  onSave,
  onReload,
}: {
  canEdit: boolean;
  changed: boolean;
  saving: boolean;
  savedBy: string | null;
  error: Error | null;
  onSave: () => void;
  onReload: () => void;
}) {
  const conflict = error instanceof ApiError && error.code === 'notes_changed';
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
        {canEdit ? (
          <button
            type="button"
            disabled={!changed || saving}
            onClick={onSave}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        ) : (
          <span>Only people in this meeting write its notes.</span>
        )}
        {savedBy ? <span>Last saved by {savedBy}</span> : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger-soft">
          {error.message}{' '}
          {conflict ? (
            <button type="button" onClick={onReload} className="underline">
              Load the newer notes
            </button>
          ) : null}
        </p>
      ) : null}
    </>
  );
}

/** The follow-ups in the saved notes: each done one shows its issue, each open one can become one. */
function FollowUps({
  workspaceId,
  notes,
  items,
  canFile,
  onFiled,
}: {
  workspaceId: string;
  notes: string;
  items: FollowUp[];
  canFile: boolean;
  onFiled: (marked: string) => void;
}) {
  const projects = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => call(contracts['projects.list'], { params: { workspaceId } }),
    enabled: items.length > 0,
  });
  const boards = (projects.data?.projects ?? []).filter((project) => !project.archived);
  const [boardId, setBoardId] = useState('');
  const file = useMutation({
    mutationFn: async (item: FollowUp) => {
      const { issue } = await call(contracts['issues.create'], {
        params: { workspaceId, projectId: boardId || boards[0]!.id },
        body: { title: item.text },
      });
      return { issue, item };
    },
    onSuccess: ({ issue, item }) => onFiled(markFollowUp(notes, item.line, issue.key)),
  });
  if (items.length === 0) return null;

  return (
    <section className="border-t border-line pt-2">
      <div className="flex items-center justify-between gap-2">
        <h5 className="text-xs font-medium text-muted">Follow-ups</h5>
        {canFile && boards.length > 1 ? (
          <select
            aria-label="Board for new issues"
            value={boardId || boards[0]!.id}
            onChange={(event) => setBoardId(event.target.value)}
            className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs text-content"
          >
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item.line} className="flex items-baseline gap-2 text-sm">
            <span aria-hidden="true" className={item.done ? 'text-accent-soft' : 'text-faint'}>
              {item.done ? '✓' : '○'}
            </span>
            <span
              className={`min-w-0 flex-1 ${item.done ? 'text-faint line-through' : 'text-content'}`}
            >
              {item.text}
            </span>
            {item.key ? (
              <IssueKeyLink workspaceId={workspaceId} issueKey={item.key} />
            ) : !item.done && canFile && boards.length > 0 ? (
              <button
                type="button"
                disabled={file.isPending}
                onClick={() => file.mutate(item)}
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface hover:text-content disabled:opacity-50"
              >
                Make an issue
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {file.isError ? (
        <p role="alert" className="mt-1 text-xs text-danger-soft">
          {(file.error as Error).message}
        </p>
      ) : null}
    </section>
  );
}

/** A follow-up's issue, by key, opening it. */
function IssueKeyLink({ workspaceId, issueKey }: { workspaceId: string; issueKey: string }) {
  const issue = useQuery({
    queryKey: ['issue-key', workspaceId, issueKey],
    queryFn: () => call(contracts['issues.byKey'], { params: { workspaceId, key: issueKey } }),
    retry: false,
  });
  if (!issue.data)
    return <span className="shrink-0 font-mono text-[11px] text-faint">{issueKey}</span>;
  return (
    <Link
      href={issueHref(workspaceId, issue.data.issue.id)}
      className="shrink-0 font-mono text-[11px] text-accent-soft hover:underline"
    >
      {issueKey}
    </Link>
  );
}
