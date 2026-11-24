'use client';

import { contracts, IMPORT_CSV_MAX_BYTES, IMPORT_ZIP_MAX_BYTES } from '@robis/shared';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { Button, InlineError } from '../../components/ui/primitives.tsx';
import { ApiError, BASE_URL, call } from '../../lib/api.ts';
import { boardHref } from '../../lib/links.ts';

/**
 * Import issues into a board (C6), from a CSV file, a Robis workspace
 * export or a GitHub repository. Each file is sent as it is; statuses and
 * labels are mapped, and running the same import again adds nothing.
 */

type Result = {
  found: number;
  created: number;
  skipped: number;
  labelsCreated: number;
  comments: number;
  problems: { row: number; reason: string }[];
};

const SOURCES = {
  csv: {
    title: 'From a CSV file',
    hint: 'The first row names the columns: title (needed), description, status, priority, labels and id. Statuses such as open, in progress or closed are mapped. An issue deleted after importing comes back if the same file is imported again.',
    accept: '.csv,text/csv',
    type: 'text/csv',
    max: IMPORT_CSV_MAX_BYTES,
  },
  robis: {
    title: 'From a Robis export',
    hint: 'The zip an admin downloads from People, Export. Every issue in it comes here, with its labels and comments.',
    accept: '.zip,application/zip',
    type: 'application/zip',
    max: IMPORT_ZIP_MAX_BYTES,
  },
} as const;

type Source = keyof typeof SOURCES;

function summary(result: Result) {
  const parts = [`${result.created} of ${result.found} issues added`];
  if (result.skipped) parts.push(`${result.skipped} already here`);
  if (result.labelsCreated) parts.push(`${result.labelsCreated} new labels`);
  if (result.comments) parts.push(`${result.comments} comments`);
  return `${parts.join(', ')}.`;
}

function SourceForm({
  workspaceId,
  projectId,
  source,
}: {
  workspaceId: string;
  projectId: string;
  source: Source;
}) {
  const client = useQueryClient();
  const spec = SOURCES[source];
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const id = `import-${source}`;

  async function send() {
    if (!file) return;
    if (file.size > spec.max) {
      setError(`That file is larger than ${spec.max / 1024 / 1024} MB.`);
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(
        `${BASE_URL}/workspaces/${workspaceId}/projects/${projectId}/import/${source}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': spec.type },
          body: file,
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? 'The import did not work.');
      setResult(payload as Result);
      await client.invalidateQueries();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The import did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-xl border border-line p-4">
      <h2 id={`${id}-title`} className="text-sm font-semibold text-content">
        {spec.title}
      </h2>
      <p id={`${id}-hint`} className="mt-1 max-w-[65ch] text-xs leading-relaxed text-muted">
        {spec.hint}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label htmlFor={id} className="sr-only">
          {spec.title}
        </label>
        <input
          id={id}
          type="file"
          aria-describedby={`${id}-hint`}
          accept={spec.accept}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-raised file:px-3 file:py-1.5 file:text-sm file:text-content"
        />
        <Button variant="primary" disabled={!file || busy} onClick={() => void send()}>
          {busy ? 'Importing…' : 'Import'}
        </Button>
      </div>
      {error ? (
        <div className="mt-2">
          <InlineError>{error}</InlineError>
        </div>
      ) : null}
      {/* Always rendered, so the result is announced when it arrives. */}
      <p role="status" className={result ? 'mt-2 text-sm text-content' : 'sr-only'}>
        {result ? summary(result) : ''}
      </p>
      {result && result.problems.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-xs text-faint">
          {result.problems.map((problem) => (
            <li key={`${problem.row}-${problem.reason}`}>
              {source === 'csv' ? 'Row' : 'Line'} {problem.row}: {problem.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

const FIELD =
  'min-w-0 flex-1 rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-content outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60';

/** Issues from a GitHub repository; the token is sent for this import and kept nowhere. */
function GitHubForm({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const client = useQueryClient();
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const done = await call(contracts['imports.github'], {
        params: { workspaceId, projectId },
        body: { repo: repo.trim(), ...(token.trim() ? { token: token.trim() } : {}) },
      });
      setResult(done);
      setToken('');
      await client.invalidateQueries();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The import did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="import-github-title" className="rounded-xl border border-line p-4">
      <h2 id="import-github-title" className="text-sm font-semibold text-content">
        From GitHub
      </h2>
      <p id="import-github-hint" className="mt-1 max-w-[65ch] text-xs leading-relaxed text-muted">
        A repository&rsquo;s issues, not its pull requests, with their labels and comments. Open
        issues arrive to do, closed ones done. A token is needed only for a private repository or a
        higher rate limit; it is used for this import alone and never kept. A read-only token is
        enough.
      </p>
      <form onSubmit={send} className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="import-github-repo" className="sr-only">
          Repository, as owner/name
        </label>
        <input
          id="import-github-repo"
          className={FIELD}
          placeholder="owner/name"
          aria-describedby="import-github-hint"
          autoCapitalize="none"
          spellCheck={false}
          value={repo}
          onChange={(event) => setRepo(event.target.value)}
        />
        <label htmlFor="import-github-token" className="sr-only">
          Token (optional)
        </label>
        <input
          id="import-github-token"
          className={FIELD}
          type="password"
          autoComplete="off"
          placeholder="Token (optional)"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        <Button type="submit" variant="primary" disabled={!repo.trim() || busy}>
          {busy ? 'Importing…' : 'Import'}
        </Button>
      </form>
      {error ? (
        <div className="mt-2">
          <InlineError>{error}</InlineError>
        </div>
      ) : null}
      <p role="status" className={result ? 'mt-2 text-sm text-content' : 'sr-only'}>
        {result ? summary(result) : ''}
      </p>
    </section>
  );
}

export function ImportView({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  return (
    <div className="space-y-4">
      <SourceForm workspaceId={workspaceId} projectId={projectId} source="csv" />
      <SourceForm workspaceId={workspaceId} projectId={projectId} source="robis" />
      <GitHubForm workspaceId={workspaceId} projectId={projectId} />
      <Link
        href={boardHref(workspaceId, projectId)}
        className="inline-block text-sm text-accent-soft hover:underline"
      >
        Back to the board
      </Link>
    </div>
  );
}
