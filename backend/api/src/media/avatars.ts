import type { Avatar } from '@robis/shared';

type AvatarColumns = {
  id: string;
  avatarKind: 'photo' | 'generated' | null;
  avatarRef: string | null;
  avatarUpdatedAt: Date | null;
};

/**
 * The wire form of a stored avatar.
 *
 * The photo URL carries a version, so a browser that cached the old picture
 * asks again after a change instead of showing it for the cache's lifetime.
 */
export function avatarOf(row: AvatarColumns): Avatar {
  if (row.avatarKind === 'photo' && row.avatarRef) {
    const version = row.avatarUpdatedAt?.getTime() ?? 0;
    return { kind: 'photo', url: `/users/${row.id}/avatar?v=${version}` };
  }
  if (row.avatarKind === 'generated' && row.avatarRef) {
    return { kind: 'generated', seed: row.avatarRef };
  }
  return null;
}
