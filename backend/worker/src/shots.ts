import { issueAgentToken, revokeAgentToken } from '@robis/auth';
import { type Database, stories, workspaces } from '@robis/database';
import { STORY_TONES } from '@robis/shared';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { callTool } from './mcp-call.ts';
import type { JobHandler } from './runner.ts';

/**
 * Different shots (Phase 2c): an idea a day for the team to try, posted by
 * the workspace's chosen agent as a story with a Try it button. Scripted,
 * from the list below; no language model, nothing sent anywhere.
 *
 * Like the triage agent it works through the MCP server with a token made
 * for the one run, so the API's permissions, retry ledger and audit trail
 * apply to it as to anyone, and the trail names it.
 */

export const SHOTS_JOB = 'shots.post';
/** How often the job looks; each workspace still gets at most one shot a day. */
export const SHOTS_INTERVAL_MS = 60 * 60 * 1000;
const RUN_TOKEN_TTL_MS = 5 * 60_000;

type Shot = { body: string; tryPath: string; tryLabel: string };

/** The ideas, in order; `{ws}` is the workspace's id. Each opens what it describes. */
export const SHOT_IDEAS: readonly Shot[] = [
  {
    body: 'Share a photo of your desk, or the view from it, on the feed.',
    tryPath: '/workspaces/{ws}/feed',
    tryLabel: 'Open the feed',
  },
  {
    body: 'Sign in with your fingerprint or face: add a passkey and skip the password.',
    tryPath: '/account#passkeys',
    tryLabel: 'Add a passkey',
  },
  {
    body: 'Paste a screenshot straight into a chat message. No saving, no attaching.',
    tryPath: '/workspaces/{ws}',
    tryLabel: 'Open the chat',
  },
  {
    body: 'Give your profile a cover and a line on what you are working on.',
    tryPath: '/workspaces/{ws}/people',
    tryLabel: 'Find your profile',
  },
  {
    body: 'Write it down once: start a document the whole team can edit together.',
    tryPath: '/workspaces/{ws}/documents',
    tryLabel: 'Start a document',
  },
  {
    body: 'Book a meeting at a time that suits everyone, right here.',
    tryPath: '/workspaces/{ws}/meetings',
    tryLabel: 'See meetings',
  },
  {
    body: 'See what the team got done this week, all in one place.',
    tryPath: '/workspaces/{ws}/activity',
    tryLabel: 'See activity',
  },
  {
    body: 'Search issues, documents and comments at once.',
    tryPath: '/workspaces/{ws}/search',
    tryLabel: 'Search',
  },
  {
    body: 'Two-factor sign-in keeps your account yours, even if a password leaks.',
    tryPath: '/account#two-factor',
    tryLabel: 'Turn it on',
  },
  {
    body: 'Post a story: a photo or a few words the team sees for a day.',
    tryPath: '/workspaces/{ws}/feed',
    tryLabel: 'Post a story',
  },
  {
    body: 'Thank someone today: Celebrate their post on the feed.',
    tryPath: '/workspaces/{ws}/feed',
    tryLabel: 'Open the feed',
  },
];

/** Today's idea for a workspace: the same all day, a different one tomorrow. */
export function shotFor(
  workspaceId: string,
  now: Date,
): Shot & { tone: (typeof STORY_TONES)[number] } {
  const day = Math.floor(now.getTime() / 86_400_000);
  // Spread workspaces across the list, so two teams do not get the same day.
  const offset = [...workspaceId].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const idea = SHOT_IDEAS[(day + offset) % SHOT_IDEAS.length]!;
  return {
    body: idea.body,
    tryLabel: idea.tryLabel,
    tryPath: idea.tryPath.replace('{ws}', workspaceId),
    tone: STORY_TONES[(day + offset) % STORY_TONES.length]!,
  };
}

/** Workspaces with a shots agent and stories on, that have had no shot from it today. */
async function due(db: Database, now: Date) {
  const startOfDay = new Date(Math.floor(now.getTime() / 86_400_000) * 86_400_000);
  return db
    .select({ workspaceId: workspaces.id, agentId: workspaces.shotsAgentId })
    .from(workspaces)
    .where(
      and(
        isNotNull(workspaces.shotsAgentId),
        eq(workspaces.storiesEnabled, true),
        sql`not exists (
          select 1 from ${stories}
          where ${stories.workspaceId} = ${workspaces.id}
            and ${stories.authorId} = ${workspaces.shotsAgentId}
            and ${stories.tryPath} is not null
            and ${stories.createdAt} >= ${startOfDay.toISOString()}::timestamptz
        )`,
      ),
    );
}

export function shotsHandler(options: {
  mcpUrl: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}): JobHandler {
  const fetcher = options.fetcher ?? fetch;
  return async (_payload, { db }) => {
    const now = options.now?.() ?? new Date();
    for (const { workspaceId, agentId } of await due(db, now)) {
      if (!agentId) continue;
      const token = await issueAgentToken(db, {
        agentId,
        workspaceId,
        createdBy: agentId,
        label: 'shots run',
        // The real clock: a token lives five minutes from now, whatever day it is for.
        expiresAt: new Date(Date.now() + RUN_TOKEN_TTL_MS),
      });
      try {
        const shot = shotFor(workspaceId, now);
        // Keyed by workspace and day: a retried job posts the same shot once.
        const day = Math.floor(now.getTime() / 86_400_000);
        await callTool(fetcher, `${options.mcpUrl}/mcp/${workspaceId}`, token.secret, 'post_shot', {
          ...shot,
          idempotencyKey: `shot:${workspaceId}:${day}`,
        });
      } catch (error) {
        // One workspace's refusal (a guest agent, stories just turned off)
        // must not stop the rest.
        console.warn(`shots: workspace ${workspaceId} skipped: ${(error as Error).message}`);
      } finally {
        await revokeAgentToken(db, { tokenId: token.id, agentId, workspaceId }).catch(
          () => undefined,
        );
      }
    }
  };
}
