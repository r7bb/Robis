/**
 * What the demo's people and agents say (demo:life): written lines, picked
 * at random, about the seeded projects. No model writes them; nothing here
 * is sent anywhere but the demo's own workspace.
 */

/** Chat, by channel name; a channel not listed takes `general`'s lines. */
export const CHAT: Readonly<Record<string, readonly string[]>> = {
  general: [
    'Morning all. Coffee is on in the kitchen if anyone is in.',
    'Has anyone seen the new board filters? Saved views are a lifesaver.',
    'Lunch at one? The place round the corner has soup again.',
    'Reminder: demo on Thursday, I will put the agenda in Meetings.',
    'Just closed my last review for today. Inbox zero, briefly.',
    'Is the staging stack up for everyone, or just me?',
    'Nice work on the search change, it feels instant now.',
    'I am heads down this afternoon, ping me if it is urgent.',
    'Who is around on Friday? Thinking of a short retro.',
    'Small win: the flaky upload test passed fifty runs in a row.',
    'Back from the dentist. What did I miss?',
    'The Insights page says our median cycle time dropped. Nice.',
    'Anyone fancy pairing on the Safari auth bug later?',
    'Heads up, I am rebasing the sync branch in ten minutes.',
    'Thanks for the quick turnaround on that fix yesterday.',
    'Trying out the keyboard shortcuts properly today. J and K, all day.',
    'The live updates are so quick I keep thinking I refreshed.',
    'Going to tidy the Backend board before standup.',
    'Raise your hand if you have read the new runbook. Just me?',
    'Weekly check-in is up on the Feed, takes a minute.',
  ],
  'offline-sync': [
    'Replayed a queue of forty edits after a train tunnel. All landed once.',
    'The idempotency ledger caught a double send again. Good ledger.',
    'Should a refused write show a toast, or just a mark on the card?',
    'Tried airplane mode for an hour. Nothing lost, nothing doubled.',
    'Sync lag on Insights is a nice touch, I can finally see it.',
    'Thinking about how long we keep a queued photo before giving up.',
    'Reconnect after a laptop sleep is smooth now.',
    'Found one edge: deleting an issue someone else already deleted. Handled.',
    'Can we log how often the queue drains in a burst?',
    'Offline create, then an edit, then reconnect. Order kept.',
  ],
  'design-review': [
    'Dropping the new empty states in here before they ship.',
    'Contrast on the faint text is borderline in the light theme.',
    'I like the throughput bars. Maybe a touch more space under them.',
    'Should the health tiles line up with the project cards above?',
    'The meeting card answers read well on a phone now.',
    'Let us keep one accent per page, the badges were drifting.',
    'Focus rings look right everywhere I tabbed today.',
    'Could the celebration cards be a little quieter?',
    'Reduced motion check done: nothing moves that should not.',
    'Proposal: the sidebar gets a little more air between groups.',
  ],
};

/** What the demo's agents say in chat: status, never small talk. */
export const AGENT_CHAT: readonly string[] = [
  'Board check: nothing urgent is unassigned right now.',
  'Two issues have been in review for over a day.',
  'New issues this morning are triaged, suggestions left as comments.',
  'The oldest open issue on Web App is worth a look.',
  'All quiet on the queue. Every job ran on time today.',
  'Today’s Different shot is on the Feed, if anyone wants a five-minute break.',
  'Reminder: the weekly check-in closes on Friday.',
  'Three issues finished since yesterday. Nice going.',
];

/** Feed posts by people. */
export const POSTS: readonly string[] = [
  'Shipped the board filters today. Saved views next.',
  'Quiet week, good week. The queue has been empty since Monday.',
  'Paired on the Safari bug for an hour and finally caught it in the act.',
  'First week on the Backend board and it already feels like home.',
  'Our cycle time is down to under three days. Proud of this team.',
  'Wrote up how the offline queue works, link in the docs channel.',
  'Spent the morning closing old issues. The board breathes again.',
  'New this week: live updates arrive in about ten milliseconds.',
  'Retro takeaway: smaller issues, finished sooner.',
  'Thank you to whoever fixed the flaky test. You know who you are.',
  'The design review channel is my favourite place this week.',
  'Took the afternoon to tidy our labels. Fewer, clearer.',
  'Demo went well. Questions were all about the offline mode.',
  'Shout out to the team for a calm release.',
];

/** Feed posts by the demo's agents. */
export const AGENT_POSTS: readonly string[] = [
  'Daily round-up: three issues finished, two in review, none blocked.',
  'Nothing urgent waiting today. The oldest open issue is a week old.',
  'Board check: every issue in progress has someone on it.',
  'Two issues look alike this week. Worth a glance before both are fixed.',
  'Reminder: issues finished stay done only if nobody reopens them. Nice streak.',
  'A quiet hour on the board. A good moment for reviews.',
  'Weekly figure: most issues went from started to done in under four days.',
  'Tip: press C on the board to file an issue without the mouse.',
];

/** Comments on issues by people. */
export const ISSUE_COMMENTS: readonly string[] = [
  'I can reproduce this on Safari, not on Chrome.',
  'Picking this up after lunch.',
  'Pushed a fix, could someone give it a look?',
  'Is this still happening after the last deploy?',
  'Added steps to reproduce in the description.',
  'This one is smaller than it looks, I think.',
  'Blocked on the API change, will check back tomorrow.',
  'Looks good to me. Moving it along.',
  'Can we split this into two? The second half is a separate change.',
  'Tested on a phone, works now.',
  'Left a note on the edge case with an empty title.',
  'Thanks, that was quicker than expected.',
];

/** Comments on issues by the demo's agents. */
export const AGENT_ISSUE_COMMENTS: readonly string[] = [
  'This looks related to another open issue about authentication. Worth linking.',
  'No activity here for a few days. Still in progress?',
  'Suggested priority: medium, from similar issues in this project.',
  'Moved along after the last comment said it was ready.',
  'Similar wording to an issue finished last month. The fix there may help.',
  'This has been in review for a while. Could someone take a look?',
];

/** Comments on Feed posts by people. */
export const POST_COMMENTS: readonly string[] = [
  'Well done!',
  'Love this.',
  'Great work, team.',
  'Nice one, thanks for sharing.',
  'This made my morning.',
  'Agreed, that was a good week.',
  'Ha, finally!',
  'Thanks for writing this up.',
  'So good to see.',
  'Count me in for the next one.',
];

/** Issues filed by people and agents. */
export const ISSUE_TITLES: readonly string[] = [
  'Board scrolls to the top after a filter change',
  'Show who is typing in a document',
  'Meeting card time is off by an hour after the clocks change',
  'Empty state for a project with no issues',
  'Search should match issue keys like REL-12',
  'Faint text contrast in the light theme',
  'Retry a refused upload from the card',
  'Sort the project list by most recent activity',
  'Keyboard shortcut to jump to Insights',
  'Avatar crop is off centre on wide photos',
  'Paste a link as a mention in chat',
  'Show the health tiles to operators on a phone',
  'Long issue titles wrap badly on the board',
  'Remember the last channel per workspace',
  'Mark a check-in answer as private',
  'Export a project board as CSV',
];

/** Replies in a space. */
export const SPACE_REPLIES: readonly string[] = [
  'The backup job runs at noon and saturates the link. Moving it to midnight fixed it for us.',
  'Ask in the access request form; the platform lead approves within a day.',
  'There is one in the design library under Foundations. Use that one.',
  'Leave a comment with where you stopped and what you would try next. That helps most.',
  'Same here. Restarting the client helped once, but not reliably.',
  'Big yes to this.',
  'I tried this last week and it worked first time.',
  'Could we try it for a month and see?',
  'This saved me an hour today, thanks.',
  'Worth adding to the onboarding guide.',
];
