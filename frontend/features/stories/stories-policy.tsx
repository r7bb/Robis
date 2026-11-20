'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch } from '../../components/ui/switch.tsx';
import { ApiError, call } from '../../lib/api.ts';
import { storiesKey } from './story-model.ts';

/**
 * An owner's switch (B2): whether this workspace has stories at all. Off
 * hides the ones there are and refuses new ones; they still go at their 24
 * hours, so turning it back on within the day shows what was there.
 */
export function StoriesPolicy({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => call(contracts['workspaces.get'], { params: { workspaceId } }),
  });
  const set = useMutation({
    mutationFn: (enabled: boolean) =>
      call(contracts['workspaces.setStoriesEnabled'], {
        params: { workspaceId },
        body: { enabled },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] });
      await queryClient.invalidateQueries({ queryKey: storiesKey(workspaceId) });
    },
  });
  const enabled = workspace.data?.workspace.storiesEnabled ?? true;

  return (
    <section
      aria-labelledby="stories-policy"
      className="rounded-lg border border-line bg-raised p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="stories-policy" className="text-sm font-medium text-content">
            Stories
          </h2>
          <p className="mt-1 text-sm text-muted">
            {enabled
              ? 'On: members can share a photo or a few words that this workspace sees for 24 hours.'
              : 'Off. Nobody here sees stories or can post one. Turn it on to bring back any from the last 24 hours.'}
          </p>
        </div>
        <Switch
          checked={enabled}
          onChange={(next) => set.mutate(next)}
          disabled={!workspace.data || set.isPending}
          labelledBy="stories-policy"
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
