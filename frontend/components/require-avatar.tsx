'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api, type Me } from '../lib/api.ts';
import { useRequireAvatar } from '../lib/use-require-avatar.ts';

/**
 * Every page inside a workspace goes through this, so a bookmarked board or
 * issue sends someone without a picture to the welcome step instead of to
 * an unexplained 403 from the API.
 */
export function RequireAvatar({ children }: { children: ReactNode }) {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });
  useRequireAvatar(me.data);
  return children;
}
