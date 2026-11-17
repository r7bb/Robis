import { type IssueStatus, positionBetween } from '@robis/shared';

/**
 * Where a dropped card goes (C1): a key between the cards it lands between,
 * so the move writes that card alone. Cards made offline have no key yet;
 * the nearest neighbours that have one bound the new key instead.
 */

type Card = { id: string; status: IssueStatus; position: string | null };

export function dropPosition(column: readonly Card[], movedId: string, index: number): string {
  const others = column.filter((card) => card.id !== movedId);
  const slot = Math.max(0, Math.min(index, others.length));
  const above = others
    .slice(0, slot)
    .reverse()
    .find((card) => card.position !== null);
  const below = others.slice(slot).find((card) => card.position !== null);
  return positionBetween(above?.position ?? null, below?.position ?? null);
}
