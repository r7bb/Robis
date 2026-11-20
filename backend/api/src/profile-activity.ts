import { can, type Permission, type Role } from '@robis/shared';

/**
 * Which of a person's audit events their profile shows (B2), and what the
 * viewer must be able to read to see each.
 *
 * Work only: what they did to issues, projects, documents, meetings, rooms
 * and stories. Never who joined, left or changed roles, a workspace's
 * settings, agents and their tokens, the trail's own housekeeping, or
 * anything personal like a saved view. A type not listed here is not shown,
 * so an event added later stays off profiles until someone decides it
 * belongs.
 */
const SHOWN: readonly { prefix: string; needs: Permission }[] = [
  { prefix: 'issue.', needs: 'issue:read' },
  { prefix: 'comment.', needs: 'comment:read' },
  { prefix: 'attachment.', needs: 'issue:read' },
  { prefix: 'label.', needs: 'issue:read' },
  { prefix: 'project.', needs: 'project:read' },
  { prefix: 'document.', needs: 'workspace:read' },
  { prefix: 'meeting.', needs: 'meeting:read' },
  { prefix: 'channel.', needs: 'channel:read' },
  { prefix: 'message.', needs: 'channel:read' },
];

/**
 * Taking down a comment, a message or an image: moderation, often of
 * someone else's, and not a profile's business to show who did it to whom.
 */
export const PROFILE_ACTIVITY_HIDDEN = [
  'comment.deleted',
  'message.deleted',
  'attachment.deleted',
] as const;

/** Posting a story, while the workspace has them; taking one down is moderation. */
const STORY_POSTED = 'story.added';

/** The event types (as `like` patterns) a viewer with `role` may see on a profile. */
export function profileActivityPatterns(role: Role, storiesEnabled: boolean): string[] {
  const patterns = SHOWN.filter((rule) => can(role, rule.needs)).map((rule) => `${rule.prefix}%`);
  return storiesEnabled ? [...patterns, STORY_POSTED] : patterns;
}
