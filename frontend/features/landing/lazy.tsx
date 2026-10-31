'use client';

import dynamic from 'next/dynamic';
import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * Whether the element is in view or about to be: false until it first comes
 * within `rootMargin` of the viewport, then true for good (stage 3, item 33).
 * Where there is no IntersectionObserver, true at once.
 */
function useNearView<T extends Element>(rootMargin = '200px') {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, rootMargin]);

  return { ref, near };
}

/**
 * Render `children` only once this spot is near the viewport, and `fallback`
 * until then. With a component loaded through `next/dynamic`, its code is
 * then fetched after the page has hydrated, not as part of it: the landing
 * becomes usable first and the heavy parts arrive as they come into view.
 */
export function WhenNear({
  children,
  fallback = null,
  className,
}: {
  children: ReactNode;
  fallback?: ReactNode;
  className?: string;
}) {
  const { ref, near } = useNearView<HTMLDivElement>();
  return (
    <div ref={ref} className={className}>
      {near ? children : fallback}
    </div>
  );
}

/**
 * The landing's two heavy pieces, each in a chunk of its own, fetched only
 * when rendered: the WebGL field, and the live sync demo. Neither renders on
 * the server; both appear once their spot is near the viewport (`WhenNear`).
 * Under `prefers-reduced-motion` the field still draws one still frame and
 * the demo does not animate, as each already did.
 */
export const LazyField = dynamic(() => import('./field.tsx').then((m) => m.Field), {
  ssr: false,
});

export const LazySyncDemo = dynamic(() => import('./sync-demo.tsx').then((m) => m.SyncDemo), {
  ssr: false,
});
