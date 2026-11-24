/**
 * Keep the demo workspace lively: `bun run demo:life` against a running
 * development stack, until stopped.
 *
 * The seeded teammates (not the owner, whose account is yours) sign in
 * with the demo password and stay present over live sockets, so they show
 * as here. Two agents join them: Scout, the workspace's triage agent, and
 * Saphi, its Different shots agent. Every so often one of them does
 * something a teammate would: says a line in a channel, posts to the Feed,
 * reacts or comments, comments on an issue, moves one along, or files one.
 * The words are written lines picked at random (scripts/demo/content.ts);
 * no model writes them and nothing leaves the stack. Everything goes
 * through the API, so it is audited, rate-limited and arrives live.
 *
 * Development only: the demo password is refused anywhere else, and the
 * runner refuses an address that is not this machine or the compose
 * network unless LIFE_ALLOW_REMOTE=1. Stopping it (Ctrl+C) revokes the
 * agents' tokens and closes the sockets.
 */

import { boardOf, DO, type World } from './actions.ts';
import { type Actor, asAgent, RefusedError, type Stack, signIn, stayPresent } from './client.ts';
import { type ActorRole, nextAction, pause, pickOne } from './plan.ts';
import { agentWriter, personWriter, type Writer, writeTogether } from './write-together.ts';

const stack: Stack = {
  web: process.env.LIFE_WEB_URL ?? 'http://127.0.0.1:3000',
  origin: process.env.LIFE_WEB_ORIGIN ?? 'http://localhost:3000',
};
const WORKSPACE_SLUG = process.env.LIFE_WORKSPACE ?? 'engineering';
const MIN_PAUSE_MS = Number(process.env.LIFE_MIN_SECONDS ?? 20) * 1000;
const MAX_PAUSE_MS = Number(process.env.LIFE_MAX_SECONDS ?? 60) * 1000;
/** After a refusal for too many requests, a longer rest. */
const REST_AFTER_LIMIT_MS = 120_000;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', 'edge', 'web']);

const PEOPLE = [
  { email: 'alex@robis.test', name: 'Alex' },
  { email: 'john@robis.test', name: 'John' },
  { email: 'mia@robis.test', name: 'Mia' },
];

/** `formerly`: names it went by, so a renamed agent is found and renamed, not made twice. */
const AGENTS: { name: string; triage: boolean; shots: boolean; formerly?: string[] }[] = [
  { name: 'Scout', triage: true, shots: false },
  { name: 'Saphi', triage: false, shots: true, formerly: ['Muse', 'RoRo', 'Wren'] },
];

const log = (line: string) =>
  process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${line}\n`);

function refuseRemote() {
  const host = new URL(stack.web).hostname;
  if (!LOCAL_HOSTS.has(host) && process.env.LIFE_ALLOW_REMOTE !== '1') {
    throw new Error(`demo:life runs against a local stack only, not ${host}`);
  }
}

type Signed = Awaited<ReturnType<typeof signIn>>;

/** The demo workspace, found by its slug, and this person's role in it. */
async function roleIn(person: Signed, workspaceId: string): Promise<ActorRole> {
  const { workspace } = await person.call<{ workspace: { role: string } }>(
    'GET',
    `/workspaces/${workspaceId}`,
  );
  return workspace.role === 'OWNER' ? 'ADMIN' : (workspace.role as ActorRole);
}

async function findWorkspace(person: Signed): Promise<string> {
  const { workspaces } = await person.call<{ workspaces: { id: string; slug: string }[] }>(
    'GET',
    '/workspaces',
  );
  const found = workspaces.find((workspace) => workspace.slug === WORKSPACE_SLUG);
  if (!found) throw new Error(`no workspace "${WORKSPACE_SLUG}": run the seed with --team first`);
  return found.id;
}

/** An agent at work: who it is, its token (to revoke on leaving), and whether it drafts in documents. */
type Held = { actor: Actor; agentId: string; tokenId: string; secret: string; writes: boolean };

/** The demo's agents, made by an admin if missing, each with a fresh token. */
async function bringAgents(admin: Signed, workspaceId: string): Promise<Held[]> {
  const path = `/workspaces/${workspaceId}/agents`;
  const { agents } = await admin.call<{ agents: { id: string; name: string }[] }>('GET', path);
  const label = `demo:life ${new Date().toISOString().slice(0, 16)}`;
  return Promise.all(
    AGENTS.map(async (spec) => {
      const existing = agents.find(
        (agent) => agent.name === spec.name || spec.formerly?.includes(agent.name),
      );
      if (existing && existing.name !== spec.name) {
        await admin.call('PATCH', `${path}/${existing.id}`, { name: spec.name });
        log(`renamed ${existing.name} to ${spec.name}`);
      }
      if (existing) {
        const token = await admin.call<{ token: { id: string; secret: string } }>(
          'POST',
          `${path}/${existing.id}/tokens`,
          { label },
        );
        return {
          actor: asAgent(stack, spec.name, existing.id, token.token.secret),
          secret: token.token.secret,
          writes: spec.shots,
          agentId: existing.id,
          tokenId: token.token.id,
        };
      }
      const made = await admin.call<{
        agent: { id: string };
        token: { id: string; secret: string };
      }>('POST', path, {
        name: spec.name,
        role: 'MEMBER',
        tokenLabel: label,
        triage: spec.triage,
        shots: spec.shots,
      });
      return {
        actor: asAgent(stack, spec.name, made.agent.id, made.token.secret),
        secret: made.token.secret,
        writes: spec.shots,
        agentId: made.agent.id,
        tokenId: made.token.id,
      };
    }),
  );
}

/** One action by someone, said in the log; a refusal is logged, not fatal. */
async function act(actors: readonly Actor[], world: World): Promise<boolean> {
  const actor = pickOne(actors, world.random)!;
  const openIssues = (await boardOf(actor, world).catch(() => [])).flatMap(({ issues }) =>
    issues.filter((issue) => issue.status !== 'DONE' && issue.status !== 'CANCELED'),
  ).length;
  const action = nextAction(actor.role, openIssues, world.random);
  if (!action) return true;
  try {
    const said = await DO[action](actor, world);
    if (said) log(`${actor.name} ${said}`);
    return true;
  } catch (error) {
    log(`${actor.name} could not ${action}: ${error instanceof Error ? error.message : error}`);
    return !(error instanceof RefusedError && error.status === 429);
  }
}

/** How long between two people writing together: every few minutes. */
const MIN_WRITE_GAP_MS = 90_000;
const MAX_WRITE_GAP_MS = 240_000;

async function main() {
  refuseRemote();
  log(`demo:life against ${stack.web}, workspace ${WORKSPACE_SLUG}`);
  const people = await Promise.all(PEOPLE.map((p) => signIn(stack, p.email, p.name)));
  const workspaceId = await findWorkspace(people[0]!);
  const roles = await Promise.all(people.map((person) => roleIn(person, workspaceId)));
  const leaving = people.map((person) => stayPresent(stack, person.cookie, workspaceId));
  log(`present: ${people.map((p) => p.name).join(', ')}`);

  const adminIndex = roles.indexOf('ADMIN');
  const agents = adminIndex === -1 ? [] : await bringAgents(people[adminIndex]!, workspaceId);
  log(`agents at work: ${agents.map((held) => held.actor.name).join(', ') || 'none'}`);

  const actors: Actor[] = [
    ...people.map((person, i) => ({ ...person, role: roles[i]! })),
    ...agents.map((held) => held.actor),
  ];
  const world: World = { workspaceId, random: Math.random, recent: [] };

  let running = true;
  // Now and then two of the people write in the same document at once.
  // The people who may edit, and the ideas agent, which drafts beside them.
  const writers: Writer[] = [
    ...people.filter((_, i) => roles[i] !== 'GUEST').map((person) => personWriter(stack, person)),
    ...agents.filter((held) => held.writes).map((held) => agentWriter(held.actor, held.secret)),
  ];
  void (async () => {
    while (running) {
      await Bun.sleep(pause(MIN_WRITE_GAP_MS, MAX_WRITE_GAP_MS, world.random));
      if (!running) break;
      try {
        const said = await writeTogether(stack, writers, workspaceId, world.random, world.recent);
        if (said) log(said);
      } catch (error) {
        log(`writing together did not happen: ${error instanceof Error ? error.message : error}`);
      }
    }
  })();
  const stop = async () => {
    if (!running) return;
    running = false;
    log('stopping: revoking the agents’ tokens and closing the sockets');
    for (const leave of leaving) leave();
    const admin = people[adminIndex];
    await Promise.all(
      agents.map((held) =>
        admin
          ?.call(
            'DELETE',
            `/workspaces/${workspaceId}/agents/${held.agentId}/tokens/${held.tokenId}`,
          )
          .catch(() => undefined),
      ),
    );
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());

  while (running) {
    const fine = await act(actors, world);
    await Bun.sleep(fine ? pause(MIN_PAUSE_MS, MAX_PAUSE_MS, world.random) : REST_AFTER_LIMIT_MS);
  }
}

await main();
