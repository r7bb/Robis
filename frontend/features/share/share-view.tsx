'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { ApiError, call } from '../../lib/api.ts';
import { boardHref } from '../../lib/links.ts';
import { remembered } from '../../lib/remembered.ts';
import { getSyncEngine } from '../../lib/sync.ts';

/**
 * What another app shared to Robis (C8), waiting in the service worker's
 * share cache: pick the board, check the title, and it becomes an issue,
 * with the pictures attached and any link or words as its first comment.
 * Every step goes through the offline queue, so it works with no signal and
 * lands once the phone is back online.
 */

const SHARE_CACHE = 'robis-share';
const TITLE_MAX = 200;

type Shared = { title: string; text: string; url: string; images: Blob[] };
type Board = { workspaceId: string; projectId: string; label: string };

async function readShare(): Promise<Shared | null> {
  if (typeof caches === 'undefined') return null;
  const cache = await caches.open(SHARE_CACHE);
  const meta = await cache.match('/share/inbox/meta');
  if (!meta) return null;
  const head = (await meta.json()) as { title: string; text: string; url: string; files: number };
  const images: Blob[] = [];
  for (let i = 0; i < head.files; i++) {
    const file = await cache.match(`/share/inbox/file-${i}`);
    if (file) images.push(await file.blob());
  }
  return { title: head.title, text: head.text, url: head.url, images };
}

async function forgetShare() {
  if (typeof caches !== 'undefined') await caches.delete(SHARE_CACHE);
}

function firstTitle(shared: Shared): string {
  const line = [shared.title, shared.text, shared.url, shared.images.length ? 'Shared photo' : '']
    .map((value) => value.split('\n')[0]?.trim() ?? '')
    .find(Boolean);
  return (line ?? 'Shared from another app').slice(0, TITLE_MAX);
}

const FIELD =
  'w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-content outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60';

/** Every board the person can put an issue on, as "Workspace / Board". */
function useBoards() {
  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: remembered('workspaces', () => call(contracts['workspaces.list'])),
    retry: false,
  });
  const list = workspaces.data?.workspaces ?? [];
  const boards = useQuery({
    queryKey: ['share-boards', list.map((w) => w.id).join(',')],
    enabled: list.length > 0,
    queryFn: async () => {
      const all: Board[] = [];
      for (const workspace of list) {
        const { projects } = await remembered(`projects:${workspace.id}`, () =>
          call(contracts['projects.list'], { params: { workspaceId: workspace.id } }),
        )();
        for (const project of projects) {
          all.push({
            workspaceId: workspace.id,
            projectId: project.id,
            label: `${workspace.name} / ${project.name}`,
          });
        }
      }
      return all;
    },
  });
  const signedOut = workspaces.error instanceof ApiError && workspaces.error.status === 401;
  return { boards: boards.data ?? [], ready: boards.isSuccess, signedOut };
}

/** Make the issue, attach the pictures and leave the words, all through the queue. */
async function fileShare(shared: Shared, board: Board, title: string) {
  const engine = getSyncEngine();
  const { workspaceId, projectId } = board;
  const issue = await engine.createIssue(workspaceId, projectId, {
    title: title.trim().slice(0, TITLE_MAX) || firstTitle(shared),
  });
  for (const image of shared.images) {
    await engine.queueAttachment(workspaceId, issue.id, image, image.type);
  }
  const words = [shared.text, shared.url].filter(Boolean).join('\n\n').trim();
  if (words) await engine.queueComment(workspaceId, issue.id, words);
  await forgetShare();
  void engine.flush();
}

export function ShareView() {
  const router = useRouter();
  const [shared, setShared] = useState<Shared | null | undefined>(undefined);
  const [picked, setPicked] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { boards, ready, signedOut } = useBoards();

  useEffect(() => {
    readShare().then(
      (found) => {
        setShared(found);
        if (found) setTitle(firstTitle(found));
      },
      () => setShared(null),
    );
  }, []);

  const chosen = boards.find((b) => `${b.workspaceId}:${b.projectId}` === picked) ?? boards[0];
  const preview = useMemo(
    () => (shared?.images ?? []).map((image) => URL.createObjectURL(image)),
    [shared],
  );
  useEffect(
    () => () => {
      for (const url of preview) URL.revokeObjectURL(url);
    },
    [preview],
  );

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!shared || !chosen) return;
    setBusy(true);
    setError(null);
    try {
      await fileShare(shared, chosen, title);
      router.replace(boardHref(chosen.workspaceId, chosen.projectId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work. Try again.');
      setBusy(false);
    }
  }

  if (signedOut) {
    return (
      <p className="text-sm text-muted">
        Sign in to save what was shared; it waits here until you do.{' '}
        <Link href="/login" className="text-accent-soft hover:underline">
          Sign in
        </Link>
      </p>
    );
  }
  if (shared === undefined) return <p className="text-sm text-faint">Looking…</p>;
  if (shared === null) {
    return (
      <p className="text-sm text-muted">
        Nothing is waiting. Share a photo or a link to Robis from another app, and it arrives here.
      </p>
    );
  }

  return (
    <form onSubmit={save} className="space-y-4" aria-label="Make an issue of what was shared">
      {preview.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2">
          {preview.map((url, i) => (
            <li key={url}>
              {/* biome-ignore lint/performance/noImgElement: a local blob, not an optimisable asset */}
              <img
                src={url}
                alt={`Shared ${i + 1} of ${preview.length}`}
                className="aspect-square w-full rounded-lg object-cover"
              />
            </li>
          ))}
        </ul>
      ) : null}
      {shared.text || shared.url ? (
        <p className="whitespace-pre-wrap break-words rounded-lg border border-line p-3 text-sm text-muted">
          {[shared.text, shared.url].filter(Boolean).join('\n')}
        </p>
      ) : null}
      <label className="block text-xs text-faint">
        Title
        <input
          className={`${FIELD} mt-1`}
          required
          maxLength={TITLE_MAX}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="block text-xs text-faint">
        Board
        <select
          className={`${FIELD} mt-1`}
          value={chosen ? `${chosen.workspaceId}:${chosen.projectId}` : ''}
          onChange={(e) => setPicked(e.target.value)}
        >
          {boards.map((b) => (
            <option
              key={`${b.workspaceId}:${b.projectId}`}
              value={`${b.workspaceId}:${b.projectId}`}
            >
              {b.label}
            </option>
          ))}
        </select>
      </label>
      {boards.length === 0 && ready ? (
        <p className="text-xs text-faint">Make a board first; then share again.</p>
      ) : null}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !chosen}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Make the issue'}
        </button>
        <button
          type="button"
          className="text-sm text-muted hover:text-content"
          onClick={() => void forgetShare().then(() => setShared(null))}
        >
          Discard
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger-soft">
          {error}
        </p>
      ) : null}
    </form>
  );
}
