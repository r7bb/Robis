'use client';

import type { IssueStatus } from '@robis/shared';
import { type KeyboardEvent, useState } from 'react';
import { dropPosition } from '../../lib/board-order.ts';

/**
 * Moving cards on the board (C1), by pointer and by keyboard. A move is an
 * ordinary edit (the card's new status and position) and goes through the
 * offline queue like every other board write, so it works with no network.
 *
 * By keyboard: focus a card's Move button, press Space or Enter to lift it,
 * the arrow keys to move it (up and down within a column, left and right
 * between columns), Space or Enter to drop it, Escape to put it back. The
 * board's M key (C2) lifts the focused card the same way.
 */

type Card = { id: string; key: string; status: IssueStatus; position: string | null };
type Update = (id: string, input: { status?: IssueStatus; position: string }) => Promise<void>;

export function useBoardDrag(
  cards: readonly Card[],
  columns: readonly IssueStatus[],
  update: Update,
) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [lifted, setLifted] = useState<{ id: string; status: IssueStatus; index: number } | null>(
    null,
  );
  const [said, setSaid] = useState('');

  const column = (status: IssueStatus) => cards.filter((card) => card.status === status);

  async function move(id: string, status: IssueStatus, index: number) {
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    const position = dropPosition(column(status), id, index);
    await update(id, status === card.status ? { position } : { status, position });
  }

  /** Pointer: where in `status` the card was dropped, from the card it was dropped on. */
  function onDrop(status: IssueStatus, overIndex: number | null) {
    const id = dragging;
    setDragging(null);
    if (!id) return;
    void move(id, status, overIndex ?? column(status).length);
  }

  function lift(card: Card) {
    const index = column(card.status).findIndex((c) => c.id === card.id);
    setLifted({ id: card.id, status: card.status, index });
    setSaid(`Lifted ${card.key}. Arrow keys move it, Space drops it, Escape puts it back.`);
  }

  function shift(card: Card, key: string) {
    if (!lifted) return;
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const others = column(lifted.status).filter((c) => c.id !== card.id).length;
      const index = Math.max(0, Math.min(others, lifted.index + (key === 'ArrowUp' ? -1 : 1)));
      setLifted({ ...lifted, index });
      setSaid(`${card.key}: position ${index + 1} of ${others + 1}.`);
      return;
    }
    const at = columns.indexOf(lifted.status);
    const step = key === 'ArrowLeft' ? -1 : 1;
    const next = columns[Math.max(0, Math.min(columns.length - 1, at + step))]!;
    setLifted({ id: card.id, status: next, index: 0 });
    setSaid(`${card.key}: to the top of ${next.toLowerCase().replace('_', ' ')}.`);
  }

  function onKeyDown(event: KeyboardEvent, card: Card) {
    const { key } = event;
    const pick = key === ' ' || key === 'Enter';
    if (!lifted) {
      if (pick) {
        event.preventDefault();
        lift(card);
      }
      return;
    }
    if (lifted.id !== card.id) return;
    event.preventDefault();
    if (key === 'Escape') {
      setLifted(null);
      setSaid(`${card.key} put back.`);
    } else if (pick) {
      setLifted(null);
      setSaid(`Dropped ${card.key}.`);
      void move(card.id, lifted.status, lifted.index);
    } else if (key.startsWith('Arrow')) {
      shift(card, key);
    }
  }

  /**
   * Put a lifted card back where it was: when focus leaves its Move button,
   * a lift left hanging would drop it later somewhere stale, and the
   * board's other keys would act on a card mid-move.
   */
  function putBack(card: Card) {
    if (lifted?.id !== card.id) return;
    setLifted(null);
    setSaid(`${card.key} put back.`);
  }

  /** What a card needs to be dragged by pointer. */
  function cardProps(id: string, index: number, canMove: boolean) {
    return {
      'data-index': index,
      draggable: canMove,
      onDragStart: (event: { dataTransfer: DataTransfer }) => {
        event.dataTransfer.effectAllowed = 'move';
        setDragging(id);
      },
      onDragEnd: () => setDragging(null),
    };
  }

  /** How a card looks while it is being moved. */
  function cardState(id: string) {
    if (dragging === id) return 'opacity-50';
    return lifted?.id === id ? 'ring-2 ring-accent-soft' : '';
  }

  return { dragging, lifted, said, lift, putBack, onDrop, onKeyDown, cardProps, cardState };
}
