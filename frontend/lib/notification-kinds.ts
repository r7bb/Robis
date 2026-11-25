import type { NotificationKind } from '@robis/shared';

/** Each kind of notification as people read it (C3): the account page and the unsubscribe page. */
export const NOTIFICATION_KIND_NAMES: Record<NotificationKind, { name: string; when: string }> = {
  mention: { name: 'Mentions', when: 'Someone writes your @name in a comment.' },
  assignment: { name: 'Given to you', when: 'Someone makes you the assignee of an issue.' },
  issue_comment: {
    name: 'Comments on your issues',
    when: 'On an issue you filed or are assigned, by anyone but you.',
  },
  meeting: {
    name: 'Meeting changes',
    when: 'A meeting you are in is moved, changed or called off.',
  },
  nudge: { name: 'Suggestions', when: 'A next step to try, at most one a week.' },
  space_reply: {
    name: 'Replies in spaces',
    when: 'Someone replies to your thread, or to your reply, in a space.',
  },
  space_answer: {
    name: 'Answers marked',
    when: 'Your reply is marked as the answer to a question.',
  },
  cycle_ending: {
    name: 'Cycles ending',
    when: 'The day before a cycle ends, while issues of yours in it are still open.',
  },
  release_due: {
    name: 'Releases due',
    when: 'The day before a release is due, while issues of yours in it are still open.',
  },
};
