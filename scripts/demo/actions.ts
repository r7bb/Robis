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
} from './content.ts';
import { type Action, nextStatus, pickFresh, pickOne, type Random, remember } from './plan.ts';

/** What every action can see and keeps: the workspace, and the lines said lately. */
export type World = {
  workspaceId: string;
  random: Random;
  recent: string[];
};

type Issue = { id: string; key: string; title: string; status: string };
type Post = { id: string; authorId: string };

const REACTIONS = ['celebrate', 'helpful', 'support'] as const;

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

export const DO: Readonly<Record<Action, (actor: Actor, world: World) => Promise<string | null>>> =
  {
    chat,
    post,
    react,
    issueComment,
    postComment,
    move,
    file,
  };
