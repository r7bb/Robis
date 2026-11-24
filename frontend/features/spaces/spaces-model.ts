import type { contracts, ResponseOf } from '@robis/shared';

/**
 * Spaces as the pages hold them: pure, so the reply tree and the words
 * around it are tested without a browser.
 */

export type Space = ResponseOf<(typeof contracts)['spaces.list']>['spaces'][number];
export type ThreadSummary = ResponseOf<(typeof contracts)['spaces.threads']>['threads'][number];
export type ThreadPage = ResponseOf<(typeof contracts)['spaces.thread']>;
export type Reply = ThreadPage['replies'][number];
export type ThreadKind = ThreadSummary['kind'];
export type ThreadSort = 'active' | 'new' | 'top' | 'unanswered';
export type LeaderPeriod = 'week' | 'month' | 'all';

export const spacesKey = (workspaceId: string) => ['spaces', workspaceId] as const;
export const threadKey = (workspaceId: string, threadId: string) =>
  ['space-thread', workspaceId, threadId] as const;
export const leadersKey = (workspaceId: string, period: LeaderPeriod) =>
  ['spaces-leaders', workspaceId, period] as const;

export const KINDS: Record<ThreadKind, { label: string; hint: string; tone: string }> = {
  question: {
    label: 'Question',
    hint: 'Ask, and mark the reply that solved it',
    tone: 'bg-sky-500/15 text-sky-300 ring-sky-400/30',
  },
  idea: {
    label: 'Idea',
    hint: 'Something worth trying',
    tone: 'bg-amber-500/15 text-amber-300 ring-amber-400/30',
  },
  discussion: {
    label: 'Discussion',
    hint: 'Talk it through',
    tone: 'bg-violet-500/15 text-violet-300 ring-violet-400/30',
  },
  tip: {
    label: 'Tip',
    hint: 'Something that helped you',
    tone: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30',
  },
};

export const SORTS: Record<ThreadSort, string> = {
  active: 'Active',
  new: 'New',
  top: 'Top',
  unanswered: 'Unanswered',
};

export const PERIODS: Record<LeaderPeriod, string> = {
  week: 'This week',
  month: 'This month',
  all: 'All time',
};

export type ReplyNode = Reply & { children: ReplyNode[] };

/**
 * Replies as a tree, each under the reply it answers, oldest first at
 * every level. A reply whose parent is not in the list (past what was
 * loaded) sits at the top level rather than being lost.
 */
export function nestReplies(replies: readonly Reply[]): ReplyNode[] {
  const nodes = new Map<string, ReplyNode>(
    replies.map((reply) => [reply.id, { ...reply, children: [] }]),
  );
  const roots: ReplyNode[] = [];
  for (const reply of replies) {
    const node = nodes.get(reply.id)!;
    const parent = reply.parentId ? nodes.get(reply.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Every reply under a node, at any depth: what "Hide" hides. */
export function descendants(node: ReplyNode): number {
  return node.children.reduce((sum, child) => sum + 1 + descendants(child), 0);
}

/** A tile colour for a space, the same for the same space every time. */
const TILE_TONES = [
  'from-sky-500/30 to-sky-500/5 text-sky-300',
  'from-emerald-500/30 to-emerald-500/5 text-emerald-300',
  'from-amber-500/30 to-amber-500/5 text-amber-300',
  'from-rose-500/30 to-rose-500/5 text-rose-300',
  'from-violet-500/30 to-violet-500/5 text-violet-300',
] as const;

export function tileTone(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TILE_TONES[hash % TILE_TONES.length]!;
}

/** "3 replies", "1 reply", "No replies yet". */
export function repliesLine(count: number): string {
  if (count === 0) return 'No replies yet';
  return `${count} ${count === 1 ? 'reply' : 'replies'}`;
}

/** "14 helpful · 3 answers", leaving out a zero. */
export function leaderLine(helpful: number, answers: number): string {
  const parts = [
    helpful > 0 ? `${helpful} helpful` : '',
    answers > 0 ? `${answers} ${answers === 1 ? 'answer' : 'answers'}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}
