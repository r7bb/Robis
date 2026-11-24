import { z } from 'zod';
import {
  IMPORT_MAX_ISSUES,
  type ImportedIssue,
  type ImportProblem,
  PROBLEMS_KEPT,
  sourceKey,
} from './model.ts';

/**
 * Issues from a GitHub repository (C6), through GitHub's public REST API,
 * with a token the person supplies for a private repository or a higher
 * rate limit. The token is used for these requests alone: never stored,
 * never logged, never sent anywhere but api.github.com. Pull requests are
 * left out. Open issues arrive to do, closed ones done (or cancelled when
 * closed as not planned); labels by name; comments in order. Each issue is
 * keyed by its repository and number, so a rerun adds nothing.
 */

const API = 'https://api.github.com';
const PER_PAGE = 100;
/** Pages of comments read at most; each holds a hundred, across the repository. */
const COMMENT_PAGES = 20;
const TIMEOUT_MS = 10_000;

export class GitHubRefused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const issueSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullable().optional(),
  state: z.enum(['open', 'closed']),
  state_reason: z.string().nullable().optional(),
  labels: z.array(z.union([z.string(), z.object({ name: z.string().optional() })])).optional(),
  pull_request: z.unknown().optional(),
});
const commentSchema = z.object({ issue_url: z.string(), body: z.string().nullable().optional() });

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

async function page(fetcher: Fetch, path: string, token: string | undefined): Promise<unknown[]> {
  const response = await fetcher(`${API}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'robis-import',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) {
    throw new GitHubRefused(
      'GitHub found no such repository. A private one needs a token that can read it.',
      404,
    );
  }
  if (response.status === 401) throw new GitHubRefused('GitHub did not accept that token.', 401);
  if (response.status === 403 || response.status === 429) {
    throw new GitHubRefused(
      'GitHub is limiting requests. Try again later, or give a token for a higher limit.',
      429,
    );
  }
  if (!response.ok) throw new GitHubRefused(`GitHub answered ${response.status}.`, 502);
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? body : [];
}

/** Every page of `path`, up to `pages` of them, stopping at a short page. */
async function pages(fetcher: Fetch, path: string, token: string | undefined, max: number) {
  const out: unknown[] = [];
  for (let n = 1; n <= max; n++) {
    const sep = path.includes('?') ? '&' : '?';
    const rows = await page(fetcher, `${path}${sep}per_page=${PER_PAGE}&page=${n}`, token);
    out.push(...rows);
    if (rows.length < PER_PAGE) break;
  }
  return out;
}

const statusOf = (issue: z.infer<typeof issueSchema>) => {
  if (issue.state === 'open') return 'TODO' as const;
  return issue.state_reason === 'not_planned' ? ('CANCELED' as const) : ('DONE' as const);
};

/** The issues among GitHub's rows (pull requests share the list), and what could not be read. */
function readIssues(raw: unknown[]) {
  const problems: ImportProblem[] = [];
  const found: z.infer<typeof issueSchema>[] = [];
  for (const [i, row] of raw.entries()) {
    const parsed = issueSchema.safeParse(row);
    if (parsed.success) {
      if (parsed.data.pull_request === undefined) found.push(parsed.data);
    } else if (problems.length < PROBLEMS_KEPT) {
      problems.push({ row: i + 1, reason: 'Unreadable issue' });
    }
  }
  return { found, problems };
}

/** Comment bodies by issue number, in the order GitHub gave them. */
function commentsByIssue(rows: unknown[]) {
  const out = new Map<number, string[]>();
  for (const row of rows) {
    const parsed = commentSchema.safeParse(row);
    if (!parsed.success || !parsed.data.body) continue;
    const number = Number(parsed.data.issue_url.split('/').pop());
    if (Number.isInteger(number)) out.set(number, [...(out.get(number) ?? []), parsed.data.body]);
  }
  return out;
}

export async function githubIssues(
  repo: string,
  token: string | undefined,
  fetcher: Fetch = fetch,
): Promise<{ issues: ImportedIssue[]; problems: ImportProblem[] }> {
  const issuePages = Math.ceil(IMPORT_MAX_ISSUES / PER_PAGE) + 1;
  const raw = await pages(
    fetcher,
    `/repos/${repo}/issues?state=all&sort=created&direction=asc`,
    token,
    issuePages,
  );
  const { found, problems } = readIssues(raw);
  const commentsOf =
    found.length === 0
      ? new Map<number, string[]>()
      : commentsByIssue(
          await pages(
            fetcher,
            `/repos/${repo}/issues/comments?sort=created&direction=asc`,
            token,
            COMMENT_PAGES,
          ),
        );

  const issues = found.map((issue) => ({
    key: sourceKey('github', `${repo.toLowerCase()}#${issue.number}`),
    title: issue.title.trim() || `Issue ${issue.number}`,
    description: issue.body?.trim() || null,
    status: statusOf(issue),
    priority: 'NONE' as const,
    labels: (issue.labels ?? [])
      .map((label) => (typeof label === 'string' ? label : (label.name ?? '')))
      .filter(Boolean)
      .map((name) => ({ name, colour: null })),
    comments: commentsOf.get(issue.number) ?? [],
  }));
  return { issues, problems };
}
