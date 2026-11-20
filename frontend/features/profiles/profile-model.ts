import type { contracts, ResponseOf } from '@robis/shared';

/** A profile as the page holds it (B2). */
export type ProfileData = ResponseOf<(typeof contracts)['profiles.get']>;

export const profileKey = (workspaceId: string, userId: string) =>
  ['profile', workspaceId, userId] as const;
