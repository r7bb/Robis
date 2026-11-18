'use client';

import {
  contracts,
  type NotificationChannel,
  type NotificationKind,
  type ResponseOf,
} from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';
import { NOTIFICATION_KIND_NAMES } from '../../lib/notification-kinds.ts';

/**
 * Your notification settings (C3): each kind on or off, by channel. A
 * change is saved as it is made, and the list shown is what the server
 * holds, so a failed save puts the switch back.
 */

type Settings = ResponseOf<(typeof contracts)['notificationSettings.get']>;

/** The channels that deliver today; push joins when it does. */
const CHANNELS: readonly {
  id: NotificationChannel;
  name: string;
  field: 'inApp' | 'email' | 'push';
}[] = [
  { id: 'in_app', name: 'In the app', field: 'inApp' },
  { id: 'email', name: 'Email', field: 'email' },
];

const KEY = ['notification-settings'];

export function NotificationSettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: KEY,
    queryFn: () => call(contracts['notificationSettings.get']),
  });
  const save = useMutation({
    mutationFn: (body: {
      kind: NotificationKind;
      channel: NotificationChannel;
      enabled: boolean;
    }) => call(contracts['notificationSettings.set'], { body }),
    onSuccess: (next: Settings) => queryClient.setQueryData(KEY, next),
  });

  if (settings.isPending) {
    return <div className="h-48 animate-pulse rounded-lg border border-line bg-raised" />;
  }
  if (settings.isError) {
    return (
      <p role="alert" className="text-sm text-danger-soft">
        Your settings could not be loaded. {(settings.error as Error).message}
      </p>
    );
  }

  return (
    <div>
      <table className="w-full overflow-hidden rounded-lg border border-line bg-raised text-sm">
        <caption className="sr-only">Which notifications reach you, and where</caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-faint">
            <th scope="col" className="px-4 py-2 font-medium">
              Kind
            </th>
            {CHANNELS.map((channel) => (
              <th key={channel.id} scope="col" className="w-28 px-4 py-2 text-right font-medium">
                {channel.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {settings.data.settings.map((setting) => (
            <tr key={setting.kind}>
              <th scope="row" className="px-4 py-3 text-left font-normal">
                <span className="block text-content">
                  {NOTIFICATION_KIND_NAMES[setting.kind].name}
                </span>
                <span className="block text-xs text-faint">
                  {NOTIFICATION_KIND_NAMES[setting.kind].when}
                </span>
              </th>
              {CHANNELS.map((channel) => (
                <td key={channel.id} className="px-4 py-3 text-right">
                  <input
                    type="checkbox"
                    checked={setting.channels[channel.field]}
                    // Not disabled while a save is in flight, which would drop the
                    // keyboard's place; a change made meanwhile is ignored, and the
                    // switch shows what the server holds.
                    aria-disabled={save.isPending}
                    onChange={(event) => {
                      if (save.isPending) return;
                      save.mutate({
                        kind: setting.kind,
                        channel: channel.id,
                        enabled: event.target.checked,
                      });
                    }}
                    aria-label={`${NOTIFICATION_KIND_NAMES[setting.kind].name}, ${channel.name.toLowerCase()}`}
                    className="h-4 w-4 accent-accent"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 min-h-5 text-xs text-faint" aria-live="polite">
        {save.isError ? (
          <span className="text-danger-soft">Not saved: {(save.error as Error).message}</span>
        ) : save.isSuccess ? (
          'Saved.'
        ) : (
          'Mentions are emailed as they happen; everything else comes in one summary a day. Invitations to a workspace always reach you.'
        )}
      </p>
    </div>
  );
}
