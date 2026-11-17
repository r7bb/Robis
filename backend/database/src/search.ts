import { sql } from 'drizzle-orm';
import type { Executor } from './index.ts';

/**
 * Full-text search across a workspace.
 *
 * Postgres rather than a dedicated engine. What that buys: results are read
 * from the same transaction that wrote them, so a freshly created issue is
 * findable immediately and there is no indexing pipeline to fall behind, fail
 * silently, or reconcile after a restore. The index is a stored generated
 * column, so it cannot drift from the row.
 *
 * What it costs: no fuzzy matching or typo tolerance, English-only stemming as
 * configured, and ranking that is far less tunable than a purpose-built
 * engine. Those are the reasons to reach for one -- not the word "search".
 */

export type HighlightPart = { text: string; match: boolean };

export type SearchKind = 'issue' | 'document' | 'comment';

/*
 * The headline marks matches with two control characters, and the same two
 * are stripped from the text before it is excerpted, so only Postgres can
 * put them there. Nobody types them, and they are not markup.
 */
const START = '\u0002';
const STOP = '\u0003';
const HEADLINE_OPTIONS = `StartSel=${START}, StopSel=${STOP}, MaxFragments=1, MaxWords=24, MinWords=8`;

/** A headline split into its plain and matched pieces. */
export function headlineParts(headline: string): HighlightPart[] {
  const parts: HighlightPart[] = [];
  for (const [index, piece] of headline.split(new RegExp(`[${START}${STOP}]`)).entries()) {
    // Split pieces alternate: outside, inside, outside, ... a match.
    if (piece) parts.push({ text: piece, match: index % 2 === 1 });
  }
  return parts;
}

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  /**
   * An excerpt in plain text pieces, the matched terms marked. Built from
   * the headline's own delimiters rather than markup, so nothing in the text
   * can pose as a match and nothing needs decoding. (Postgres leaves
   * anything tag-shaped out of an excerpt.)
   */
  parts: HighlightPart[];
  rank: number;
  /** Where to navigate. Comments point at the issue that holds them. */
  issueId: string | null;
  projectId: string | null;
};

/**
 * Turn user input into a tsquery.
 *
 * `websearch_to_tsquery` is the right parser for a search box: it accepts
 * quoted phrases, `or`, and leading `-` for exclusion, and -- unlike
 * `to_tsquery` -- it never throws on punctuation a user happens to type.
 */
export async function searchWorkspace(
  db: Executor,
  workspaceId: string,
  query: string,
  { limit = 20, type }: { limit?: number; type?: SearchKind } = {},
): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  /*
   * One UNION rather than three round trips, so ranking is comparable across
   * kinds and the limit applies to the merged set. Each branch carries the
   * text its excerpt is made from; `ts_headline` then runs only on the page
   * of hits, from the same query.
   */
  const rows = await db.execute<{
    kind: SearchHit['kind'];
    id: string;
    title: string;
    snippet: string;
    rank: number;
    issue_id: string | null;
    project_id: string | null;
  }>(sql`
    with q as (select websearch_to_tsquery('english', ${trimmed}) as query,
                      ${HEADLINE_OPTIONS}::text as options,
                      ${START + STOP}::text as marks,
                      ${type ?? null}::text as only),

    -- Ranked and cut to the page first; the excerpt, the costly part, is
    -- made below for the rows that survive, not for every match.
    hits as (
    select 'issue' as kind,
           i.id::text as id,
           i.title as title,
           coalesce(i.description, i.title) as source,
           ts_rank(i.search_vector, q.query) as rank,
           i.id::text as issue_id,
           i.project_id::text as project_id
      from issues i, q
     where i.workspace_id = ${workspaceId} and i.search_vector @@ q.query
       and (q.only is null or q.only = 'issue')

    union all

    select 'document', d.id::text, d.title,
           coalesce(d.search_text, d.title),
           ts_rank(d.search_vector, q.query),
           null, d.project_id::text
      from documents d, q
     where d.workspace_id = ${workspaceId} and d.search_vector @@ q.query
       and (q.only is null or q.only = 'document')

    union all

    select 'comment', c.id::text, i2.title,
           c.body,
           -- Comments rank below the things they are attached to: a match in
           -- a thread is usually a weaker answer than a match in the issue.
           ts_rank(c.search_vector, q.query) * 0.6,
           c.issue_id::text, i2.project_id::text
      from comments c
      join issues i2 on i2.id = c.issue_id and i2.workspace_id = ${workspaceId}, q
     where c.workspace_id = ${workspaceId} and c.search_vector @@ q.query
       and (q.only is null or q.only = 'comment')

     order by rank desc
     limit ${limit}
    )

    select h.kind, h.id, h.title,
           ts_headline('english', translate(h.source, q.marks, ''), q.query, q.options) as snippet,
           h.rank, h.issue_id, h.project_id
      from hits h, q
     order by h.rank desc
  `);

  return [...rows].map((row) => ({
    kind: row.kind,
    id: row.id,
    title: row.title,
    parts: headlineParts(row.snippet),
    rank: Number(row.rank),
    issueId: row.issue_id,
    projectId: row.project_id,
  }));
}
