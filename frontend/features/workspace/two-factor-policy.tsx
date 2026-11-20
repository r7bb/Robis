'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Switch } from '../../components/ui/switch.tsx';
import { ApiError, call } from '../../lib/api.ts';

/**
 * An admin's switch (C4): require two-factor sign-in of everyone in the
 * workspace. Turning it on needs it on the admin's own account first; once
 * on, a member without it is shown the way to turn it on and nothing else.
 */
export function TwoFactorPolicy({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => call(contracts['workspaces.get'], { params: { workspaceId } }),
  });
  const set = useMutation({
    mutationFn: (required: boolean) =>
      call(contracts['workspaces.setTwoFactorRequired'], {
        params: { workspaceId },
        body: { required },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] }),
  });
  const required = workspace.data?.workspace.requireTwoFactor ?? false;
  const needsOwnFirst =
    set.error instanceof ApiError && set.error.code === 'two_factor_needed_first';

  return (
    <section
      aria-labelledby="two-factor-policy"
      className="rounded-lg border border-line bg-raised p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="two-factor-policy" className="text-sm font-medium text-content">
            Require two-factor sign-in
          </h2>
          <p className="mt-1 text-sm text-muted">
            {required
              ? 'On: everyone signs in with a code from an app as well as their password. Anyone without it is asked to turn it on before they can open this workspace.'
              : 'Off. When on, everyone here must sign in with a code from an authenticator app as well as their password.'}
          </p>
        </div>
        <Switch
          checked={required}
          onChange={(next) => set.mutate(next)}
          disabled={!workspace.data || set.isPending}
          labelledBy="two-factor-policy"
        />
      </div>
      <div aria-live="polite">
        {set.error ? (
          <p className="mt-3 text-sm text-danger-soft">
            {set.error instanceof ApiError ? set.error.message : 'That did not change.'}{' '}
            {needsOwnFirst ? (
              <Link href="/account#two-factor" className="underline underline-offset-2">
                Your account page
              </Link>
            ) : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}
