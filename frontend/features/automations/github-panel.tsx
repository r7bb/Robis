'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, InlineError } from '../../components/ui/primitives.tsx';
import { ApiError, call } from '../../lib/api.ts';

/**
 * GitHub pull requests on issues (C7), for admins: connect, copy the
 * address and secret into the repository's webhook settings, and choose
 * whether a merge moves the issue to done. A new secret replaces the old.
 */

const messageOf = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That did not work. Try again.';

export function GitHubPanel({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient();
  const key = ['github', workspaceId];
  const link = useQuery({
    queryKey: key,
    queryFn: () => call(contracts['github.link'], { params: { workspaceId } }),
  });
  const [moveToDone, setMoveToDone] = useState(true);
  const [secret, setSecret] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const connect = useMutation({
    onMutate: () => setSecret(null),
    mutationFn: (choice: boolean) =>
      call(contracts['github.connect'], { params: { workspaceId }, body: { moveToDone: choice } }),
    onSuccess: (made) => {
      setSecret(made.secret);
      void refresh();
    },
  });
  const update = useMutation({
    mutationFn: (choice: boolean) =>
      call(contracts['github.update'], { params: { workspaceId }, body: { moveToDone: choice } }),
    onSuccess: refresh,
  });
  const disconnect = useMutation({
    mutationFn: () => call(contracts['github.disconnect'], { params: { workspaceId } }),
    onSuccess: () => {
      setSecret(null);
      void refresh();
    },
  });
  const current = link.data?.link ?? null;
  const error = link.error ?? connect.error ?? update.error ?? disconnect.error;
  const address = current ? `${window.location.origin}${current.webhookPath}` : '';

  return (
    <section aria-labelledby="github-heading" className="space-y-4">
      <div>
        <h2 id="github-heading" className="text-sm font-semibold text-content">
          GitHub
        </h2>
        <p className="mt-1 max-w-[65ch] text-xs leading-relaxed text-faint">
          A pull request whose title or branch names an issue key, such as WEB-12, shows on that
          issue with its state. GitHub signs what it sends with the secret below; anything unsigned
          is refused. Any repository given the secret can name any issue here, so give it only to
          your own.
        </p>
      </div>
      {error ? <InlineError>{messageOf(error)}</InlineError> : null}

      {current ? (
        <div className="space-y-3 rounded-xl border border-line p-4 text-sm">
          <p className="text-content">
            In the repository: Settings, Webhooks, Add webhook. Payload URL:
          </p>
          <code className="block break-all font-mono text-xs text-content">{address}</code>
          <p className="text-xs text-muted">
            Content type application/json, the secret shown when connecting, and the event Pull
            requests.
          </p>
          <label className="flex items-center gap-2 text-content">
            <input
              type="checkbox"
              checked={current.moveToDone}
              disabled={update.isPending}
              onChange={(e) => update.mutate(e.target.checked)}
            />
            Merging a pull request moves its issues to done
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => connect.mutate(current.moveToDone)}>
              Make a new secret
            </Button>
            <Button size="sm" variant="danger" onClick={() => disconnect.mutate()}>
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-line p-4 text-sm">
          <label className="flex items-center gap-2 text-content">
            <input
              type="checkbox"
              checked={moveToDone}
              onChange={(e) => setMoveToDone(e.target.checked)}
            />
            Merging a pull request moves its issues to done
          </label>
          <Button
            variant="primary"
            disabled={connect.isPending}
            onClick={() => connect.mutate(moveToDone)}
          >
            {connect.isPending ? 'Connecting…' : 'Connect GitHub'}
          </Button>
        </div>
      )}

      <div
        role="status"
        className={
          secret ? 'rounded-md border border-accent-soft/40 bg-accent/10 p-3 text-xs' : 'sr-only'
        }
      >
        {secret ? (
          <>
            <p className="text-content">
              The webhook secret, shown this once. Paste it into GitHub:
            </p>
            <code className="mt-1 block break-all font-mono text-content">{secret}</code>
          </>
        ) : null}
      </div>
    </section>
  );
}
