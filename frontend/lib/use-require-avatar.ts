'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { Me } from './api.ts';

/**
 * Send someone without a picture to the welcome step first.
 *
 * Robis is a place people recognise each other in, so a picture comes
 * before anything else: an upload, a camera shot, or a generated pattern.
 * The API and the realtime gateway enforce the same rule; this is the part
 * that takes a person to the welcome step instead of an error.
 */
export function useRequireAvatar(me: Me | undefined) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (me && me.user.avatar === null) {
      router.replace(`/welcome?next=${encodeURIComponent(pathname)}`);
    }
  }, [me, pathname, router]);
}
