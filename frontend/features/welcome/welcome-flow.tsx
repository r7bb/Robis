'use client';

import type { Avatar as AvatarRef } from '@robis/shared';
import { contracts } from '@robis/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  type ClipboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Avatar, orbStyle } from '../../components/ui/avatar.tsx';
import { ApiError, api, BASE_URL, call, type Me } from '../../lib/api.ts';
import { CameraCapture } from './camera-capture.tsx';
import { preparePhoto } from './prepare-photo.ts';

type Mode = 'upload' | 'camera' | 'pattern';

const MODES: { id: Mode; label: string }[] = [
  { id: 'upload', label: 'Upload a photo' },
  { id: 'camera', label: 'Take one now' },
  { id: 'pattern', label: 'Pick a pattern' },
];

const PATTERN_COUNT = 8;

/**
 * Patterns to offer. The first is always the one derived from the account
 * id, so the same person is offered the same "own" pattern on every device;
 * the rest are fresh each time.
 */
function seedsFor(userId: string | undefined): string[] {
  const own = userId ? [`id-${userId.replaceAll('-', '').slice(0, 12)}`] : [];
  const random = Array.from({ length: PATTERN_COUNT - own.length }, () =>
    `orb-${Math.random().toString(36).slice(2, 10)}`.slice(0, 32),
  );
  return [...own, ...random];
}

async function uploadPhoto(source: Blob): Promise<AvatarRef> {
  const body = await preparePhoto(source);
  const response = await fetch(`${BASE_URL}/auth/me/avatar`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': body.type },
    body,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error ?? 'unknown',
      payload?.message ?? 'That picture could not be saved',
    );
  }
  return payload.avatar as AvatarRef;
}

/**
 * The first thing a new member does: choose how they appear.
 *
 * Three ways in, one preview. Pasting a screenshot works from anywhere on
 * the page. Nothing is required beyond picking one, and all of it can be
 * changed later from Account.
 */
export function WelcomeFlow({ next }: { next: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const tabsId = useId();

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => call(contracts['auth.me']),
    retry: false,
  });
  const [mode, setMode] = useState<Mode>('upload');
  const [seeds, setSeeds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const user = me.data?.user;
  const chosen = user?.avatar ?? null;
  // Built once per account, not per render: a fresh random set on every
  // render would replace the pattern someone just picked with others.
  const initialPatterns = useMemo(() => seedsFor(user?.id), [user?.id]);
  const patterns = seeds ?? initialPatterns;

  const save = useCallback(
    async (work: () => Promise<AvatarRef>) => {
      setBusy(true);
      setError(null);
      try {
        const avatar = await work();
        queryClient.setQueryData<Me>(['me'], (current) =>
          current ? { user: { ...current.user, avatar } } : current,
        );
        // Every list that shows this person's picture is now stale.
        await queryClient.invalidateQueries({ queryKey: ['members'] });
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'That picture could not be saved');
      } finally {
        setBusy(false);
      }
    },
    [queryClient],
  );

  const choosePhoto = (blob: Blob) => save(() => uploadPhoto(blob));
  const choosePattern = (seed: string) =>
    save(async () => {
      const response = await api<{ avatar: AvatarRef }>('/auth/me/avatar/generated', {
        method: 'PUT',
        body: { seed },
      });
      return response.avatar;
    });

  function onPaste(event: ClipboardEvent<HTMLElement>) {
    // One picture at a time: a second paste while the first is saving would
    // race it and leave one of the two files orphaned.
    if (busy) return;
    const item = [...event.clipboardData.items].find((entry) => entry.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (file) {
      event.preventDefault();
      void choosePhoto(file);
    }
  }

  // Only a real "not signed in" goes to the login page; a network blip or a
  // server error should not throw someone out mid-choice.
  const signedOut = me.error instanceof ApiError && me.error.status === 401;
  useEffect(() => {
    if (signedOut) router.replace('/login');
  }, [signedOut, router]);
  if (signedOut) return null;

  return (
    <main
      onPaste={onPaste}
      className="relative grid min-h-[100dvh] place-items-center overflow-hidden px-4 py-12"
    >
      {/* A soft wash in the accent, behind everything: the one decorative
          move on the page, so the picture is what draws the eye. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl"
      />

      <section className="relative w-full max-w-md">
        <p className="text-sm font-medium text-accent-soft">
          Welcome{user ? `, ${user.name.split(' ')[0]}` : ''}
        </p>
        <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight text-content">
          Put a face to your name.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Your teammates see this beside everything you post. Choose one to start; you can change it
          any time in Account.
        </p>

        <div className="mt-8 flex flex-col items-center">
          <div
            className="rounded-full p-1 ring-1 ring-line transition-shadow duration-500 data-[chosen=true]:shadow-[0_0_60px_-10px] data-[chosen=true]:shadow-accent/60"
            data-chosen={chosen !== null}
          >
            <Avatar
              name={user?.name ?? '?'}
              seed={user?.id}
              avatar={chosen}
              size="2xl"
              className="transition-transform duration-500"
            />
          </div>
          <p aria-live="polite" className="mt-3 h-5 text-xs text-faint">
            {busy ? 'Saving…' : chosen ? `This is you, @${user?.username}.` : 'No picture yet.'}
          </p>
        </div>

        <div
          role="tablist"
          aria-label="How to add a picture"
          className="mt-6 grid grid-cols-3 gap-1 rounded-full border border-line bg-raised p-1"
        >
          {MODES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              id={`${tabsId}-${option.id}`}
              aria-selected={mode === option.id}
              aria-controls={`${tabsId}-panel`}
              onClick={() => {
                setMode(option.id);
                setError(null);
              }}
              className={`rounded-full px-2 py-2 text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft sm:text-sm ${
                mode === option.id
                  ? 'bg-surface text-content shadow-sm'
                  : 'text-muted hover:text-content'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div
          id={`${tabsId}-panel`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-${mode}`}
          className="mt-5 min-h-[17rem]"
        >
          {mode === 'upload' ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line px-6 py-10 text-center">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void choosePhoto(file);
                  event.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={busy}
                className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-contrast transition-[background-color,transform] duration-200 hover:bg-accent-hover active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50"
              >
                Choose a photo
              </button>
              <p className="text-xs leading-relaxed text-faint">
                Or paste a screenshot here. Location and other details stored in the file are
                removed.
              </p>
            </div>
          ) : null}

          {mode === 'camera' ? <CameraCapture onCapture={choosePhoto} busy={busy} /> : null}

          {mode === 'pattern' ? (
            <div>
              <ul className="grid grid-cols-4 gap-3">
                {patterns.map((seed) => {
                  const selected = chosen?.kind === 'generated' && chosen.seed === seed;
                  return (
                    <li key={seed}>
                      <button
                        type="button"
                        aria-label="Use this pattern"
                        aria-pressed={selected}
                        onClick={() => void choosePattern(seed)}
                        disabled={busy}
                        style={orbStyle(seed)}
                        className={`aspect-square w-full rounded-full transition-[transform,box-shadow] duration-200 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
                          selected ? 'ring-2 ring-content ring-offset-2 ring-offset-surface' : ''
                        }`}
                      />
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={() => setSeeds(seedsFor(user?.id))}
                className="mx-auto mt-5 block text-sm text-muted underline-offset-4 hover:text-content hover:underline"
              >
                Show me others
              </button>
            </div>
          ) : null}
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger-soft"
          >
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => router.replace(next)}
          disabled={chosen === null || busy}
          className="mt-6 w-full rounded-full bg-content px-4 py-3 text-sm font-semibold text-surface transition-[opacity,transform] duration-200 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-30"
        >
          Continue
        </button>
      </section>
    </main>
  );
}
