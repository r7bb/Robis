import {
  type AuditActor,
  channels,
  type Executor,
  recordAudit,
  type Tx,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import { slugify } from '@robis/shared';
import { eq } from 'drizzle-orm';
import { ApiError } from '../errors.ts';

/** The room every new workspace is born with. */
const DEFAULT_CHANNEL_NAME = 'general';

/**
 * Find a free slug by appending `-2`, `-3`, ... The unique index is still the
 * real guarantee; this only avoids surfacing a conflict for the common case of
 * two workspaces sharing a display name.
 */
async function availableSlug(db: Executor, base: string): Promise<string> {
  const root = base || 'workspace';

  for (let suffix = 1; suffix <= 50; suffix++) {
    const candidate = suffix === 1 ? root : `${root}-${suffix}`;
    const [taken] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, candidate))
      .limit(1);

    if (!taken) return candidate;
  }

  throw ApiError.conflict('Could not derive a unique slug; please supply one', 'slug_exhausted');
}

/**
 * Make a workspace with its owner and its #general channel, audited. Shared
 * by the create route and the demo workspace (C5).
 */
export async function insertWorkspace(
  tx: Tx,
  actor: AuditActor,
  userId: string,
  input: { name: string; slug?: string; demo?: boolean },
) {
  const slug = input.slug ?? (await availableSlug(tx, slugify(input.name)));

  const [created] = await tx
    .insert(workspaces)
    .values({ name: input.name, slug, createdBy: userId, demo: input.demo ?? false })
    .onConflictDoNothing({ target: workspaces.slug })
    .returning();

  if (!created) throw ApiError.conflict('That workspace slug is taken', 'slug_taken');

  // Creating a workspace you cannot administer would be useless, so the
  // owner membership is part of the same transaction, not a follow-up call.
  await tx.insert(workspaceMembers).values({ workspaceId: created.id, userId, role: 'OWNER' });

  /*
   * Every workspace starts with somewhere to talk.
   *
   * Without this the shell opens on an empty centre column and the first
   * thing a new owner has to do is guess that chat needs a room created
   * first. In the same transaction as the workspace, so there is no state
   * where one exists without the other.
   */
  await tx.insert(channels).values({
    workspaceId: created.id,
    name: DEFAULT_CHANNEL_NAME,
    topic: 'Anything that does not belong anywhere else.',
    createdById: userId,
  });

  await recordAudit(tx, actor, {
    workspaceId: created.id,
    entityType: 'workspace',
    entityId: created.id,
    eventType: 'workspace.created',
    payload: { name: created.name, slug: created.slug, ...(created.demo ? { demo: true } : {}) },
  });

  return created;
}
