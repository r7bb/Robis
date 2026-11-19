import { and, desc, eq, sql } from 'drizzle-orm';
import type { Executor } from './index.ts';
import { channels, issues, messages, projects, users } from './schema.ts';

/**
 * Issues and chat, joined only by the issue's key typed in a message: no
 * link is stored, so a key written anywhere, before or after, counts.
 */

/** A key as people type it: letters and digits, a hyphen, a number. */
const KEY = /^([A-Za-z][A-Za-z0-9]{0,9})-(\d{1,9})$/;

/**
 * The key as a whole word, in any case and with any leading zeros: REL-4
 * and REL-04 but not REL-40 or XREL-4. Built only from a key that passed
 * `KEY`, so it holds nothing a regular expression reads as anything but
 * itself.
 */
function wholeKey(key: string): string {
  const [, prefix, digits] = KEY.exec(key)!;
  return `(^|[^A-Za-z0-9])${prefix}-0*${Number(digits)}([^A-Za-z0-9]|$)`;
}

export async function messagesNaming(
  db: Executor,
  workspaceId: string,
  key: string,
  { limit, preview }: { limit: number; preview: number },
) {
  if (!KEY.test(key)) return [];
  return db
    .select({
      id: messages.id,
      channelId: messages.channelId,
      channelName: channels.name,
      authorId: messages.authorId,
      authorName: users.name,
      authorKind: users.kind,
      body: sql<string>`left(${messages.body}, ${preview})`,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(and(eq(messages.workspaceId, workspaceId), sql`${messages.body} ~* ${wholeKey(key)}`))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit);
}

/** The issue a key names in this workspace, in any case, or null. */
export async function issueByKey(db: Executor, workspaceId: string, typed: string) {
  const match = KEY.exec(typed.trim());
  if (!match) return null;
  const [, prefix, digits] = match;
  const [row] = await db
    .select({
      id: issues.id,
      projectId: issues.projectId,
      projectKey: projects.key,
      number: issues.number,
      title: issues.title,
    })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        eq(projects.workspaceId, workspaceId),
        sql`upper(${projects.key}) = ${prefix!.toUpperCase()}`,
        eq(issues.number, Number(digits)),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.projectId,
    key: `${row.projectKey}-${row.number}`,
    title: row.title,
  };
}
