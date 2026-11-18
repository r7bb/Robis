'use client';

import type { IssueStatus, Role } from '@robis/shared';
import { useEffect, useRef } from 'react';
import { stepCard } from '../../lib/board-keys.ts';
import { useBoardShortcuts } from './use-board-shortcuts.ts';

/**
 * What the board's single keys do (C2), on the cards as they are drawn.
 * Cards are found by `data-card` and focused as a whole (`tabIndex=-1`), so
 * Tab from a focused card goes on into its own buttons.
 */

type Card = {
  id: string;
  key: string;
  status: IssueStatus;
  position: string | null;
  pending: boolean;
};
type Part = 'card' | 'move';

const card = (id: string, part: Part = 'card') => {
  const el = document.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"]`);
  return part === 'move' ? el?.querySelector<HTMLElement>('[data-move]') : el;
};

/** The card holding focus, or the one a control inside it belongs to. */
function focusedCard(): string | null {
  return document.activeElement?.closest('[data-card]')?.getAttribute('data-card') ?? null;
}

function focus(el: HTMLElement | null | undefined) {
  el?.focus();
  el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** How long a card that changed column is followed with focus. */
const REFOCUS_MS = 2_000;

export function useBoardKeyboard({
  role,
  columns,
  cards,
  compose,
  setStatus,
  lift,
  select,
  openPalette,
  openHelp,
  selecting,
  stopSelecting,
}: {
  role: Role | undefined;
  /** Card ids by column, as shown. */
  columns: readonly (readonly string[])[];
  cards: readonly Card[];
  compose: () => void;
  setStatus: (id: string, status: IssueStatus) => void;
  lift: (card: Card) => void;
  select: (id: string) => void;
  openPalette: (() => void) | null;
  openHelp: () => void;
  selecting: boolean;
  stopSelecting: () => void;
}) {
  // A card that moves column is drawn anew, and focus falls to the page;
  // this puts it back on the card (or its Move button) once it is drawn.
  const refocus = useRef<{ id: string; part: Part; until: number } | null>(null);
  const keepFocusOn = (id: string, part: Part = 'card') => {
    refocus.current = { id, part, until: Date.now() + REFOCUS_MS };
  };
  useEffect(() => {
    const wanted = refocus.current;
    if (!wanted) return;
    if (Date.now() > wanted.until) {
      refocus.current = null;
      return;
    }
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const el = card(wanted.id, wanted.part);
    if (el) {
      focus(el);
      refocus.current = null;
    }
  });

  const onCard = (run: (c: Card) => void) => () => {
    const id = focusedCard();
    const found = id ? cards.find((c) => c.id === id) : undefined;
    if (found) run(found);
  };
  const step = (to: 'next' | 'previous' | 'left' | 'right') => () => {
    const id = stepCard(columns, focusedCard(), to);
    if (id) focus(card(id));
  };

  useBoardShortcuts(role, {
    compose,
    next: step('next'),
    previous: step('previous'),
    left: step('left'),
    right: step('right'),
    status: (status) =>
      onCard((c) => {
        if (!status || c.status === status) return;
        keepFocusOn(c.id);
        setStatus(c.id, status);
      })(),
    lift: onCard((c) => {
      focus(card(c.id, 'move'));
      lift(c);
    }),
    select: onCard((c) => {
      if (!c.pending) select(c.id);
    }),
    // Its own button, so deleting is confirmed exactly as by pointer.
    delete: onCard((c) =>
      card(c.id)?.querySelector<HTMLElement>('button[aria-label^="Delete issue"]')?.click(),
    ),
    filter: () => focus(document.querySelector<HTMLElement>('[data-shortcut="filter"]')),
    views: () =>
      focus(
        document.querySelector<HTMLElement>('[data-shortcut="views"]') ??
          document.querySelector<HTMLElement>('[data-shortcut="filter"]'),
      ),
    palette: openPalette ?? undefined,
    help: openHelp,
    escape: selecting ? stopSelecting : undefined,
  });

  return { keepFocusOn };
}
