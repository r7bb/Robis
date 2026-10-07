'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api, type Me } from '../lib/api.ts';

/** Entry point: bounce to the workspace list or to sign-in. */
export default function Home() {
  const router = useRouter();

  const { data, isPending, isError } = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/auth/me'),
    retry: false,
  });

  useEffect(() => {
    if (isPending) return;
    router.replace(isError || !data ? '/login' : '/workspaces');
  }, [data, isError, isPending, router]);

  // Reached for a moment before the redirect resolves. A spinner for a
  // sub-second bounce is more noticeable than the wait it describes.
  return (
    <main className="grid min-h-[100dvh] place-items-center px-4">
      <p className="text-sm text-faint">
        <span className="sr-only">Loading. </span>Relay
      </p>
    </main>
  );
}
