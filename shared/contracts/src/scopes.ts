import { z } from 'zod';
import type { ServerEvent } from './events.ts';

/**
 * What a live client is showing, so the gateway sends it only the events
 * about that (stage 3, item 24). A board names its project, an issue page
 * its issue, the workspace view the workspace and the open channel. A
 * client that names nothing hears everything in its workspace.
 */
export const scopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace') }),
  z.object({ kind: z.literal('project'), projectId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal('issue'), issueId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal('channel'), channelId: z.string().min(1).max(64) }),
]);

export type Scope = z.infer<typeof scopeSchema>;

/** More than any one page shows; bounded so a client cannot grow the set without end. */
export const MAX_SCOPES = 16;

export const scopesSchema = z.array(scopeSchema).max(MAX_SCOPES);

/** A scope as one comparable string. */
export function scopeKey(scope: Scope): string {
  switch (scope.kind) {
    case 'workspace':
      return 'workspace';
    case 'project':
      return `project:${scope.projectId}`;
    case 'issue':
      return `issue:${scope.issueId}`;
    case 'channel':
      return `channel:${scope.channelId}`;
  }
}

/**
 * The scopes an event belongs to. An issue's change is the workspace's too,
 * because project lists count open issues; a comment or an image is its
 * issue's alone; a message is its channel's alone.
 */
export function scopesOf(event: ServerEvent): string[] {
  switch (event.type) {
    case 'issue.created':
    case 'issue.updated':
    case 'issue.deleted':
      return ['workspace', `project:${event.projectId}`, `issue:${event.issueId}`];
    case 'comment.created':
    case 'attachment.changed':
      return [`issue:${event.issueId}`];
    case 'message.created':
    case 'message.deleted':
      return [`channel:${event.channelId}`];
    default:
      return ['workspace'];
  }
}

/** Whether a client with these scopes (null: it named none) should hear the event. */
export function hears(scopes: ReadonlySet<string> | null, event: ServerEvent): boolean {
  return scopes === null || scopesOf(event).some((scope) => scopes.has(scope));
}
