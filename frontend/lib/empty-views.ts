import { NUDGE_GUIDES, type NudgeKind } from '@robis/shared';

/**
 * What every empty view says (C5): what goes there, and the one thing that
 * fills it. Where a nudge guide covers the same ground its summary is the
 * explanation, so a nudge in someone's inbox and the empty view it points
 * at say the same thing, and the guide is one link away for the longer
 * version.
 *
 * The action is one of: a field already on the page to move to (`focus`,
 * a selector by accessible name, so it follows the field rather than an id
 * someone has to remember to keep), or a page to go to (`href`). A view
 * whose filling button already sits beside it has no action of its own.
 */

export const EMPTY_VIEW_KEYS = [
  'workspaces',
  'boards',
  'issues',
  'docs',
  'messages',
  'meetings',
  'comments',
  'agents',
  'rules',
  'members',
] as const;

export type EmptyViewKey = (typeof EMPTY_VIEW_KEYS)[number];

type EmptyAction = { label: string } & ({ focus: string } | { href: 'first-run' | 'guide' });

export type EmptyViewCopy = {
  title: string;
  body: string;
  action?: EmptyAction;
  guide?: NudgeKind;
};

const summaryOf = (kind: NudgeKind) => NUDGE_GUIDES[kind].summary;

export const EMPTY_VIEWS: Record<EmptyViewKey, EmptyViewCopy> = {
  workspaces: {
    title: 'No workspaces yet',
    body: summaryOf('create_workspace'),
    action: { label: 'Set one up', href: 'first-run' },
    guide: 'create_workspace',
  },
  boards: {
    title: 'No boards yet',
    body: summaryOf('create_project'),
    action: { label: 'Name the first board', focus: 'input[aria-label="New project name"]' },
    guide: 'create_project',
  },
  issues: {
    title: 'This board is empty',
    body: summaryOf('create_issue'),
    action: { label: 'Add the first issue', focus: 'input[aria-label="New issue title"]' },
    guide: 'create_issue',
  },
  docs: {
    title: 'No docs yet',
    body: summaryOf('try_document'),
    action: { label: 'Try a sample', href: 'guide' },
    guide: 'try_document',
  },
  messages: {
    title: 'No messages yet',
    body: 'Conversation about the work goes here, beside the board it is about. Only members of this workspace can read it.',
    action: { label: 'Write the first', focus: 'textarea[aria-label^="Message #"]' },
  },
  meetings: {
    title: 'Nothing scheduled',
    body: 'Meetings set up here, or that you are invited to, appear in this list with a link to join.',
  },
  comments: {
    title: 'No comments yet',
    body: 'Questions, decisions and updates on this issue go here. Mention someone with @ to bring them in.',
    action: { label: 'Write the first', focus: 'textarea[aria-label="New comment"]' },
  },
  agents: {
    title: 'No agents yet',
    body: 'An agent is a member that works through the API with its own token, and every change it makes is recorded.',
    action: { label: 'Add an agent', focus: 'input[aria-label="Agent name"]' },
  },
  rules: {
    title: 'No rules yet',
    body: 'A rule does one thing when something happens to an issue: move it, assign it, comment on it, tell someone, post to a channel or call a webhook.',
    action: { label: 'Write the first rule', focus: 'form[aria-labelledby="new-rule"] input' },
  },
  members: {
    title: 'Just you so far',
    body: summaryOf('invite_teammate'),
    action: {
      label: 'Invite someone',
      focus: 'input[aria-label="Invite by email or username"]',
    },
    guide: 'invite_teammate',
  },
};

/** The guide page for a nudge kind, carrying the workspace when there is one. */
export function guideHref(kind: NudgeKind, workspaceId?: string): string {
  return workspaceId ? `/guide/${kind}?w=${encodeURIComponent(workspaceId)}` : `/guide/${kind}`;
}
