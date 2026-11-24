import { type Database, spaceReplies, spaces, spaceThreads } from '@robis/database';
import { contracts } from '@robis/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { currentMembership, requireAuth, requireMembership } from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';

/** Offered at most. */
const SIMILAR_SHOWN = 5;
/** Words a draft must share, after stop words: one alone matches too much. */
const WORDS_IN_COMMON = 2;
/** Asked on each pause in typing, so a tighter budget than ordinary reads. */
const ASKS_PER_MINUTE = 60;

/**
 * Asked before? Threads anywhere in the workspace that share at least two
 * words with a draft title, by Postgres full text over their title and body
 * (stemmed, so "dropped" finds "dropping"), answered ones first, then the
 * closest. Read through the membership guard like any other thread list.
 */
export async function similarThreadRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const limit = rateLimit({ name: 'similar-threads', limit: ASKS_PER_MINUTE, windowMs: 60_000 });

  serve(
    app,
    contracts['spaces.similar'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read'), limit] },
    async (request, { query: { q } }) => {
      const { workspaceId } = currentMembership(request);
      const draft = q.replaceAll('\u0000', '').trim();
      if (!draft) return { threads: [] };

      // The draft's words as Postgres stems them, each quoted so nothing
      // typed (a colon, a bar, a link) can be read as query syntax.
      const words = sql`(select array_agg(distinct quote_literal(lexeme)) from unnest(to_tsvector('english', ${draft})))`;
      const anyWord = sql`to_tsquery('english', array_to_string(${words}, ' | '))`;
      const rows = await db.execute<{
        id: string;
        title: string;
        space_name: string;
        solved: boolean;
        reply_count: number;
      }>(sql`
        select t.id, t.title, s.name as space_name,
               t.solved_reply_id is not null as solved,
               (select count(*)::int from ${spaceReplies} r
                 where r.thread_id = t.id and r.deleted_at is null) as reply_count
          from ${spaceThreads} t
          join ${spaces} s on s.id = t.space_id
         where t.workspace_id = ${workspaceId}
           and coalesce(array_length(${words}, 1), 0) >= ${WORDS_IN_COMMON}
           and t.search_vector @@ ${anyWord}
           -- At least two of the draft's words in the thread, not one.
           and (select count(*) from unnest(${words}) w
                 where t.search_vector @@ to_tsquery('english', w)) >= ${WORDS_IN_COMMON}
         order by (t.solved_reply_id is not null) desc,
                  ts_rank(t.search_vector, ${anyWord}) desc,
                  t.last_activity_at desc
         limit ${SIMILAR_SHOWN}
      `);
      return {
        threads: [...rows].map((row) => ({
          id: row.id,
          title: row.title,
          spaceName: row.space_name,
          solved: row.solved,
          replyCount: Number(row.reply_count),
        })),
      };
    },
  );
}
