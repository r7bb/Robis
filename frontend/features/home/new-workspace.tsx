'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';

/**
 * "New workspace" that opens into its own name field in place, rather than
 * a form that is always on screen. Escape or an empty blur closes it.
 */
export function NewWorkspace({
  onCreate,
  pending,
  error,
}: {
  onCreate: (name: string) => Promise<unknown>;
  pending: boolean;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await onCreate(name.trim());
    } catch {
      // Left open with the name kept; the error is shown below the field.
      return;
    }
    setName('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition hover:bg-accent-hover active:scale-[0.98]"
      >
        New workspace
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="home-expand flex w-full flex-col gap-2 sm:w-auto">
      <div className="flex gap-2">
        <label htmlFor="new-workspace-name" className="sr-only">
          Workspace name
        </label>
        <input
          id="new-workspace-name"
          name="workspace-name"
          autoComplete="off"
          ref={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          onBlur={() => {
            if (!name.trim()) setOpen(false);
          }}
          placeholder="Design team…"
          maxLength={80}
          className="min-w-0 flex-1 rounded-full border border-line bg-raised px-4 py-2 text-sm text-content outline-none transition placeholder:text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60 sm:w-64"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger-soft">
          {error}
        </p>
      )}
    </form>
  );
}
