/**
 * Each thing demo:life does, through the API as whoever is acting. Every
 * one reads what is there first (the channels, the feed, the board) and
 * returns a line saying what it did, or null when there was nothing to do.
 */

import type { Actor } from './client.ts';
import {
  AGENT_CHAT,
  AGENT_ISSUE_COMMENTS,
  AGENT_POSTS,
  CHAT,
  ISSUE_COMMENTS,
  ISSUE_TITLES,
  POST_COMMENTS,
  POSTS,
  SPACE_REPLIES,
} from './content.ts';
import { type Action, nextStatus, pickFresh, pickOne, type Random, remember } from './plan.ts';
import { SPACE_THREADS, SPACES } from './spaces-content.ts';

/** What every action can see and keeps: the workspace, and the lines said lately. */
export type World = {
  workspaceId: string;
  random: Random;
  recent: string[];
};

type Issue = { id: string; key: string; title: string; status: string };
type Post = { id: string; authorId: string };

const REACTIONS = ['celebrate', 'helpful', 'support', 'thanks', 'insightful'] as const;

/** A fresh line from `bank`, remembered so it is not said again soon. */
function say(world: World, bank: readonly string[]): string {
  const line = pickFresh(bank, world.recent, world.random);
  world.recent = remember(world.recent, line);
  return line;
}

const base = (world: World) => `/workspaces/${world.workspaceId}`;

/** Every issue on every project's board, as far as the first page of each goes. */
export async function boardOf(actor: Actor, world: World) {
  const { projects } = await actor.call<{ projects: { id: string; name: string }[] }>(
    'GET',
    `${base(world)}/projects`,
  );
  const lists = await Promise.all(
    projects.map(async (project) => {
      const { issues } = await actor.call<{ issues: Issue[] }>(
        'GET',
        `${base(world)}/projects/${project.id}/issues?limit=100`,
      );
      return { project, issues };
    }),
  );
  return lists;
}

async function chat(actor: Actor, world: World) {
  const { channels } = await actor.call<{ channels: { id: string; name: string }[] }>(
    'GET',
    `${base(world)}/channels`,
  );
  const channel = pickOne(channels, world.random);
  if (!channel) return null;
  const line = say(
    world,
    actor.role === 'AGENT' ? AGENT_CHAT : (CHAT[channel.name] ?? CHAT.general!),
  );
  await actor.call('POST', `${base(world)}/channels/${channel.id}/messages`, { body: line });
  return `said in #${channel.name}: ${line}`;
}

async function post(actor: Actor, world: World) {
  const line = say(world, actor.role === 'AGENT' ? AGENT_POSTS : POSTS);
  await actor.call('POST', `${base(world)}/posts`, { body: line });
  return `posted: ${line}`;
}

/** A recent post by someone else, to answer. */
async function someoneElsesPost(actor: Actor, world: World) {
  const { items } = await actor.call<{ items: { kind: string; post?: Post }[] }>(
    'GET',
    `${base(world)}/feed`,
  );
  const posts = items.flatMap((item) => (item.post ? [item.post] : []));
  return pickOne(
    posts.filter((p) => p.authorId !== actor.userId),
    world.random,
  );
}

async function react(actor: Actor, world: World) {
  const target = await someoneElsesPost(actor, world);
  if (!target) return null;
  const reaction = pickOne(REACTIONS, world.random)!;
  await actor.call('PUT', `${base(world)}/posts/${target.id}/reactions/${reaction}`);
  return `reacted ${reaction} to a post`;
}

async function postComment(actor: Actor, world: World) {
  const target = await someoneElsesPost(actor, world);
  if (!target) return null;
  const line = say(world, POST_COMMENTS);
  await actor.call('POST', `${base(world)}/posts/${target.id}/comments`, { body: line });
  return `commented on a post: ${line}`;
}

async function issueComment(actor: Actor, world: World) {
  const open = (await boardOf(actor, world)).flatMap(({ issues }) =>
    issues.filter((issue) => nextStatus(issue.status) !== null),
  );
  const issue = pickOne(open, world.random);
  if (!issue) return null;
  const line = say(world, actor.role === 'AGENT' ? AGENT_ISSUE_COMMENTS : ISSUE_COMMENTS);
  await actor.call('POST', `${base(world)}/issues/${issue.id}/comments`, { body: line });
  return `commented on ${issue.key}: ${line}`;
}

async function move(actor: Actor, world: World) {
  const movable = (await boardOf(actor, world)).flatMap(({ issues }) =>
    issues.filter((issue) => nextStatus(issue.status) !== null),
  );
  const issue = pickOne(movable, world.random);
  if (!issue) return null;
  const status = nextStatus(issue.status)!;
  await actor.call('PATCH', `${base(world)}/issues/${issue.id}`, { status });
  return `moved ${issue.key} to ${status.toLowerCase().replace('_', ' ')}`;
}

async function file(actor: Actor, world: World) {
  const board = await boardOf(actor, world);
  const target = pickOne(board, world.random);
  if (!target) return null;
  const title = say(world, ISSUE_TITLES);
  await actor.call('POST', `${base(world)}/projects/${target.project.id}/issues`, { title });
  return `filed on ${target.project.name}: ${title}`;
}

type SpaceRef = { id: string; name: string };
type ThreadRef = { id: string; title: string; authorId: string; kind: string; solved: boolean };
type ReplyRef = { id: string; authorId: string; deleted: boolean };

/** The demo's spaces, making any that are missing when the actor may. */
async function spacesOf(actor: Actor, world: World, mayStart: boolean): Promise<SpaceRef[]> {
  const { spaces } = await actor.call<{ spaces: SpaceRef[] }>('GET', `${base(world)}/spaces`);
  if (!mayStart) return spaces;
  const made: SpaceRef[] = [];
  for (const wanted of SPACES) {
    if (spaces.some((s) => s.name === wanted.name)) continue;
    const { space } = await actor.call<{ space: SpaceRef }>(
      'POST',
      `${base(world)}/spaces`,
      wanted,
    );
    made.push(space);
  }
  return [...spaces, ...made];
}

/** A recent thread in a random space, started by someone else. */
async function someoneElsesThread(actor: Actor, world: World) {
  const space = pickOne(await spacesOf(actor, world, false), world.random);
  if (!space) return null;
  const { threads } = await actor.call<{ threads: ThreadRef[] }>(
    'GET',
    `${base(world)}/spaces/${space.id}/threads?sort=active`,
  );
  const thread = pickOne(
    threads.slice(0, 8).filter((t) => t.authorId !== actor.userId),
    world.random,
  );
  return thread ? { space, thread } : null;
}

async function ask(actor: Actor, world: World) {
  const space = pickOne(await spacesOf(actor, world, true), world.random);
  if (!space) return null;
  const titles = SPACE_THREADS.map((t) => t.title);
  const title = say(world, titles);
  const thread = SPACE_THREADS.find((t) => t.title === title)!;
  await actor.call('POST', `${base(world)}/spaces/${space.id}/threads`, thread);
  return `asked in ${space.name}: ${title}`;
}

async function answer(actor: Actor, world: World) {
  const found = await someoneElsesThread(actor, world);
  if (!found) return null;
  const { replies } = await actor.call<{ replies: ReplyRef[] }>(
    'GET',
    `${base(world)}/space-threads/${found.thread.id}`,
  );
  // Now and then, a reply to a reply rather than to the thread.
  const under =
    world.random() < 0.3
      ? pickOne(
          replies.filter((r) => !r.deleted),
          world.random,
        )
      : null;
  const body = say(world, SPACE_REPLIES);
  await actor.call('POST', `${base(world)}/space-threads/${found.thread.id}/replies`, {
    body,
    ...(under ? { parentId: under.id } : {}),
  });
  return `replied in ${found.space.name}: ${body}`;
}

/** Mark someone's reply Helpful; on your own unanswered question, now and then mark it the answer. */
async function markHelpful(actor: Actor, world: World) {
  const space = pickOne(await spacesOf(actor, world, false), world.random);
  if (!space) return null;
  const { threads } = await actor.call<{ threads: ThreadRef[] }>(
    'GET',
    `${base(world)}/spaces/${space.id}/threads?sort=active`,
  );
  const thread = pickOne(threads.slice(0, 8), world.random);
  if (!thread) return null;
  const { replies } = await actor.call<{ replies: ReplyRef[] }>(
    'GET',
    `${base(world)}/space-threads/${thread.id}`,
  );
  const reply = pickOne(
    replies.filter((r) => !r.deleted && r.authorId !== actor.userId),
    world.random,
  );
  if (!reply) return null;
  await actor.call('PUT', `${base(world)}/space-reactions/${reply.id}/helpful`);
  const mine = thread.authorId === actor.userId;
  if (mine && thread.kind === 'question' && !thread.solved && world.random() < 0.5) {
    await actor.call('PUT', `${base(world)}/space-threads/${thread.id}/answer`, {
      replyId: reply.id,
    });
    return `marked an answer in ${space.name}: ${thread.title}`;
  }
  return `found a reply helpful in ${space.name}`;
}

const MESSAGE_REACTIONS = ['ok', 'love', 'laugh', 'party', 'eyes', 'done'] as const;

/** A quick reaction on someone else's recent message. */
async function reactToMessage(actor: Actor, world: World) {
  const { channels } = await actor.call<{ channels: { id: string; name: string }[] }>(
    'GET',
    `${base(world)}/channels`,
  );
  const channel = pickOne(channels, world.random);
  if (!channel) return null;
  const { messages } = await actor.call<{ messages: { id: string; authorId: string }[] }>(
    'GET',
    `${base(world)}/channels/${channel.id}/messages?limit=20`,
  );
  const message = pickOne(
    messages.filter((m) => m.authorId !== actor.userId),
    world.random,
  );
  if (!message) return null;
  const reaction = pickOne(MESSAGE_REACTIONS, world.random)!;
  await actor.call('PUT', `${base(world)}/messages/${message.id}/reactions/${reaction}`);
  return `reacted ${reaction} in #${channel.name}`;
}

const UPDATE_LINES = [
  ['on_track', 'The week went to plan: what was promised moved, and nothing new is in the way.'],
  ['on_track', 'Two items closed and the next two are started. On course for the date.'],
  ['at_risk', 'One piece is waiting on another team; the rest is moving. Watching it daily.'],
  ['at_risk', 'Review is slower than hoped. If it is not through by Thursday the date moves.'],
] as const;

/** Now and then, a word on how a board is going. */
async function projectUpdate(actor: Actor, world: World) {
  const boards = await boardOf(actor, world);
  const board = pickOne(boards, world.random);
  if (!board) return null;
  const [health, body] = pickOne(UPDATE_LINES, world.random)!;
  await actor.call('POST', `${base(world)}/projects/${board.project.id}/updates`, { health, body });
  return `wrote an update on ${board.project.name}`;
}

export const DO: Readonly<Record<Action, (actor: Actor, world: World) => Promise<string | null>>> =
  {
    chat,
    post,
    react,
    issueComment,
    postComment,
    move,
    file,
    ask,
    answer,
    markHelpful,
    reactToMessage,
    projectUpdate,
  };
