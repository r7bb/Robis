'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { Me } from './api.ts';

/**
 * Send someone to whatever they have to settle before using Robis, in the
 * order it is asked: the current terms and their username first (the
 * consent step), then a picture (the welcome step).
 *
 * The API and the realtime gateway enforce the terms and the picture too;
 * this is the part that takes a person to the question instead of an
 * error. The username is only a question, asked once.
 */
export function useRequireAvatar(me: Me | undefined) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!me) return;
    const next = encodeURIComponent(pathname);
    if (me.user.consent.needed || !me.user.usernameConfirmed) {
      router.replace(`/consent?next=${next}`);
    } else if (me.user.avatar === null) {
      router.replace(`/welcome?next=${next}`);
    }
  }, [me, pathname, router]);
}
