'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Switch } from '../../components/ui/switch.tsx';
import { ApiError, call } from '../../lib/api.ts';
import { assistKey, useAssist } from './use-assist.ts';

/**
 * An admin's switch for assistance (D3): summaries, draft agendas and issue
 * drafts from the optional language-model provider. Off by default. Saying
 * plainly what turning it on sends, and that the server needs a key too.
 */
export function AssistPolicy({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const { enabled, keyed, loaded } = useAssist(workspaceId);
  const set = useMutation({
    mutationFn: (next: boolean) =>
      call(contracts['assist.configure'], { params: { workspaceId }, body: { enabled: next } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: assistKey(workspaceId) }),
  });

  return (
    <section
      aria-labelledby="assist-policy"
      className="rounded-lg border border-line bg-raised p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="assist-policy" className="text-sm font-medium text-content">
            Assistance
          </h2>
          <p className="mt-1 max-w-[60ch] text-sm text-muted">
            {enabled
              ? 'On: people can ask for a summary of a thread or channel, a draft agenda, or an issue from a message. What they ask about is sent to the server’s language-model provider, and what comes back is marked as generated and saved nowhere until someone uses it.'
              : 'Off. Nothing anyone writes here is sent anywhere. On, people can ask for summaries, draft agendas and issue drafts, each marked as generated.'}
          </p>
          {!keyed && loaded ? (
            <p className="mt-2 text-xs text-faint">
              This server has no provider key yet (SUMMARY_API_KEY), so nothing is asked even when
              on.
            </p>
          ) : null}
        </div>
        <Switch
          checked={enabled}
          onChange={(next) => set.mutate(next)}
          disabled={!loaded || set.isPending}
          labelledBy="assist-policy"
        />
      </div>
      <div aria-live="polite">
        {set.error ? (
          <p className="mt-3 text-sm text-danger-soft">
            {set.error instanceof ApiError ? set.error.message : 'That did not change.'}
          </p>
        ) : null}
      </div>
    </section>
  );
}
