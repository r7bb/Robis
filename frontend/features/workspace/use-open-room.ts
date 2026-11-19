'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CHANNEL_PARAM } from '../../lib/links.ts';

/** `general`, the room every workspace starts with, or else the first. */
function landingRoom(rooms: { id: string; name: string }[]): string {
  return (rooms.find((room) => room.name === 'general') ?? rooms[0]!).id;
}

/** This address without the room in it: a board's filters stay. */
function withoutRoom(pathname: string): string {
  const rest = new URLSearchParams(window.location.search);
  rest.delete(CHANNEL_PARAM);
  const query = rest.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Which room is open: one named in the address (the palette's channels),
 * once it is known to be one of this workspace's; otherwise the one already
 * open while it exists; otherwise `general`, the room every workspace
 * starts with. The address then drops the name, so choosing it again works.
 */
export function useOpenRoom(rooms: { id: string; name: string }[]) {
  const [channelId, setChannelId] = useState<string | null>(null);
  // Bumped whenever a room is chosen, so the chat opens to show it.
  const [askedAt, setAskedAt] = useState<string | null>(null);
  const asked = useSearchParams().get(CHANNEL_PARAM);
  // The room last taken from the address, so it is taken once: choosing it
  // re-runs this effect before the address has caught up.
  const taken = useRef<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const choose = useCallback((id: string) => {
    setChannelId(id);
    setAskedAt(`${id}:${Date.now()}`);
  }, []);

  useEffect(() => {
    if (rooms.length === 0) return;
    if (!asked) {
      taken.current = null;
      if (!channelId || !rooms.some((room) => room.id === channelId)) {
        setChannelId(landingRoom(rooms));
      }
      return;
    }
    if (asked !== taken.current) {
      taken.current = asked;
      if (rooms.some((room) => room.id === asked)) choose(asked);
    }
    router.replace(withoutRoom(pathname), { scroll: false });
  }, [rooms, channelId, asked, router, pathname, choose]);

  return { channelId, choose, askedAt };
}
