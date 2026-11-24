import { addDays, instantOf, wallOf } from './calendar.ts';
import type { IssuePriority, IssueStatus } from './domain.ts';

/**
 * The demo workspace (C5): a workspace with example work already in it, to
 * look around before making a real one. One board with issues at every
 * stage, a document, a channel beside #general and a meeting coming up, all
 * made by the person who asked for it, as their own. Nothing in it is real
 * and nothing in it is anyone else's.
 */

type DemoIssue = { title: string; priority: IssuePriority; status: IssueStatus };

export const DEMO_WORKSPACE = {
  name: 'Demo workspace',
  project: 'Website relaunch',
  issues: [
    { title: 'Agree what the new home page must say', priority: 'HIGH', status: 'DONE' },
    { title: 'Collect screenshots of the old site', priority: 'LOW', status: 'DONE' },
    { title: 'Draft the new navigation', priority: 'HIGH', status: 'IN_REVIEW' },
    { title: 'Write copy for the pricing page', priority: 'MEDIUM', status: 'IN_PROGRESS' },
    { title: 'Fix the contact form on small phones', priority: 'URGENT', status: 'IN_PROGRESS' },
    { title: 'Pick photographs for the about page', priority: 'MEDIUM', status: 'TODO' },
    { title: 'Set up redirects from the old addresses', priority: 'HIGH', status: 'TODO' },
    { title: 'Plan the launch announcement', priority: 'LOW', status: 'TODO' },
  ] satisfies readonly DemoIssue[],
  document: {
    title: 'Relaunch plan',
    body: `Relaunch plan

What we are doing
A simpler website: fewer pages, clearer words, and a contact form that works on a phone.

Who decides what
Copy and pages: the board. Anything that needs talking through: the #relaunch channel. Anything that needs everyone at once: the weekly check-in.

Open questions
1. Do the old blog posts move across, or stay where they are?
2. Who signs off the pricing page?

This is a demo document. Edit it freely, or open it in a second window and type in both at once.
`,
  },
  channel: {
    name: 'relaunch',
    topic: 'Talk about the website relaunch. A demo channel.',
  },
  meeting: {
    title: 'Relaunch check-in',
    agenda: 'What moved this week, what is stuck, and what is next. A demo meeting.',
    durationMinutes: 30,
    /** Local time it starts, on the next weekday. */
    hour: 10,
    /** Notes as if from last week's check-in, with follow-ups to try. */
    notes: [
      'Last check-in: navigation is close; pricing copy needs a second pass.',
      '',
      '- [ ] Share the navigation draft with the whole team',
      '- [ ] Ask legal to read the pricing page',
      'TODO: List every old address that needs a redirect',
    ].join('\n'),
  },
  /** The team's word on the board, beside what its issues say. */
  update: {
    health: 'at_risk',
    body: 'Navigation is in review, but the contact form on small phones is still broken and the redirects have not started. A demo update.',
  },
  /** Which demo issue waits on which, by title. */
  blocks: [
    {
      blocked: 'Plan the launch announcement',
      blocker: 'Set up redirects from the old addresses',
    },
  ],
  /** An issue filed every week, as a team would. */
  repeat: {
    title: 'Weekly check of the site on small phones',
    cadence: 'weekly',
    weekday: 1,
    hour: 9,
    priority: 'MEDIUM',
  },
} as const;

/**
 * When the demo meeting starts: 10:00 on the next weekday after `now`, in
 * `zone`, so it is upcoming whenever the demo is made and lands in working
 * hours wherever the person is.
 */
export function demoMeetingStart(now: Date, zone: string): Date {
  let day = addDays(wallOf(now, zone), 1);
  for (;;) {
    const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) break;
    day = addDays(day, 1);
  }
  return instantOf({ ...day, hour: DEMO_WORKSPACE.meeting.hour, minute: 0 }, zone);
}
