'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { BASE_URL } from '../../lib/api.ts';
import { importSummary, type ImportResult as Result } from './import-summary.ts';

/**
 * Import meetings from an .ics file (B8): each event becomes a meeting you
 * organise, invitees matched to this workspace's people by address. Floating
 * times in the file are read in this browser's zone. What cannot be taken
 * (all-day events, repeats other than weekly) is listed with why.
 */

/** The file is read as text and sent as it is, not as JSON. */
async function upload(workspaceId: string, file: File): Promise<Result> {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const response = await fetch(
    `${BASE_URL}/workspaces/${workspaceId}/meetings/import?timeZone=${encodeURIComponent(zone)}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'text/calendar' },
      body: await file.text(),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      response.status === 413
        ? 'That file is larger than 256 KB.'
        : (payload?.message ?? 'That file could not be imported.'),
    );
  }
  return payload as Result;
}

export function ImportCalendar({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  async function choose(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await upload(workspaceId, file);
      setMessage({ text: importSummary(result), failed: false });
      await queryClient.invalidateQueries({ queryKey: ['meetings', workspaceId] });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), failed: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <input
        ref={input}
        type="file"
        accept=".ics,text/calendar"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void choose(file);
          event.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="w-full rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface hover:text-content disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      >
        {busy ? 'Importing…' : 'Import from an .ics file'}
      </button>
      {message ? (
        <p
          role={message.failed ? 'alert' : 'status'}
          className={`text-xs ${message.failed ? 'text-danger-soft' : 'text-muted'}`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
