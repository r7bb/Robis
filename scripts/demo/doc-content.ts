/**
 * The demo's sample documents (demo:life): each with the opening it is made
 * with, and the lines teammates add to it while two of them write at once.
 * Plain words, no em or en dashes, nothing too long to read in a glance.
 */

export type SampleDocument = { title: string; opening: string; lines: readonly string[] };

export const SAMPLE_DOCUMENTS: readonly SampleDocument[] = [
  {
    title: 'Launch plan',
    opening:
      'Launch plan\n\nWhat ships: the new onboarding tour and the faster board.\nWho is on point: Mia for the tour, John for performance.\n\nNotes\n',
    lines: [
      '- Freeze copy on Thursday so translation has a day.',
      '- Record a short video of the tour for the announcement.',
      '- Check the board loads in under a second with 500 cards.',
      '- Ask support which questions came up most last month.',
      '- Draft the changelog entry and share it in #general.',
      '- Plan a rollback if sign-ups drop after the release.',
      '- Book a quiet hour on launch day to watch the dashboards.',
      '- Thank the beta testers by name in the post.',
    ],
  },
  {
    title: 'Weekly sync notes',
    opening: 'Weekly sync notes\n\nAgenda: what moved, what is stuck, who needs help.\n\nNotes\n',
    lines: [
      '- Search for issue keys is fixed and shipped.',
      '- The clock change bug in meeting cards needs one more test.',
      '- Alex is out on Friday; John covers reviews.',
      '- Two support tickets point at the same export bug.',
      '- Decision: keep the Monday sync to fifteen minutes.',
      '- Follow up on the design review from Tuesday.',
      '- The demo for the customer moved to next week.',
      '- Celebrate the hundredth issue closed this quarter.',
    ],
  },
  {
    title: 'Onboarding checklist',
    opening:
      'Onboarding checklist\n\nFor anyone joining the team. Tick things off as you go.\n\nNotes\n',
    lines: [
      '- Set up your profile picture and what you are working on.',
      '- Read the launch plan and leave one question on it.',
      '- Pair with someone on a small issue in your first week.',
      '- Join #general and say hello with one fun fact.',
      '- Try the keyboard shortcuts: press ? on any board.',
      '- Turn on notifications for the projects you care about.',
      '- Ask in Spaces when stuck; nobody minds.',
      '- Book a coffee with someone outside your team.',
    ],
  },
];

/** Notes kept in a document before the oldest give way, so it never grows without end. */
export const NOTES_KEPT = 8;
