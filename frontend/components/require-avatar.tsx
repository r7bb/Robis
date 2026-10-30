'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { call } from '../lib/api.ts';
import { useRequireAvatar } from '../lib/use-require-avatar.ts';

/**
 * Every page inside a workspace goes through this, so a bookmarked board or
 * issue sends someone without a picture to the welcome step instead of to
 * an unexplained 403 from the API.
 */
export function RequireAvatar({ children }: { children: ReactNode }) {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => call(contracts['auth.me']),
    retry: false,
  });
  useRequireAvatar(me.data);
  return children;
}
