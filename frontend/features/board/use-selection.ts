'use client';

import { useCallback, useState } from 'react';

/**
 * Which cards are picked for a bulk change (C1). Selection is a mode: off,
 * nothing is picked and no checkboxes show; turning it off forgets the picks.
 * Every change makes a new set rather than editing the old one.
 */
export function useSelection() {
  const [on, setOn] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());

  const toggleOn = useCallback(() => {
    setOn((was) => !was);
    setPicked(new Set());
  }, []);

  const toggle = useCallback((id: string) => {
    setPicked((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setPicked(new Set()), []);

  return { on, toggleOn, toggle, clear, has: (id: string) => picked.has(id) };
}
