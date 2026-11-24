/**
 * English, the language every other message file follows (C9). A key is
 * where a string is used, a value its words; `{name}` is filled in when
 * shown. A key ending in `.one` or `.other` is a plural pair, chosen by
 * the locale's own plural rules. Adding a language means a file like
 * es.ts with every key here: the type and tests/i18n.test.ts refuse one
 * with a key or a `{placeholder}` missing.
 */
export const en = {
  // The workspace's sidebar.
  'nav.feed': 'Feed',
  'nav.spaces': 'Spaces',
  'nav.meetings': 'Meetings',
  'nav.calendar': 'Calendar',
  'nav.activity': 'Activity',
  'nav.insights': 'Insights',
  'nav.releases': 'Releases',
  'nav.automations': 'Automations',
  'nav.people': 'People',
  'nav.boards': 'Boards',
  'nav.docs': 'Docs',
  'nav.noBoards': 'No boards yet.',

  // The account page's language picker.
  'account.language': 'Language',
  'account.languageLead':
    'Robis in your language, with dates, times and numbers written the way your browser writes them. Parts not yet translated stay in English.',
  'account.languageFollow': 'As my browser',

  // The calendar.
  'calendar.title': 'Calendar',
  'calendar.lead': 'This workspace’s meetings and due dates, week by week, in your own time zone.',
  'calendar.weekOf': 'Week of {date}',
  'calendar.week': 'Week {number}',
  'calendar.meetings.one': '{count} meeting',
  'calendar.meetings.other': '{count} meetings',
  'calendar.due.one': '{count} issue due',
  'calendar.due.other': '{count} issues due',
  'calendar.zone': 'times in {zone}',
  'calendar.previous': 'Previous week',
  'calendar.next': 'Next week',
  'calendar.thisWeek': 'This week',
  'calendar.today': '(today)',
  'calendar.unloaded': 'The week could not be loaded. Try again in a moment.',
  'calendar.hours': 'The week, hour by hour',
  'calendar.nothing': 'Nothing planned',
  'calendar.dueItem': 'Due:',
  'calendar.noMeetings': 'No meetings this week. Schedule one from Meetings and it appears here.',
  'calendar.span': '{start} to {end}',

  // Spaces.
  'spaces.title': 'Spaces',
  'spaces.lead':
    'Topics where the team asks, answers and shares what worked. Mark what helped; the best answers rise.',
  'spaces.start': 'Start a space',
  'spaces.startIt': 'Start the space',
  'spaces.starting': 'Starting…',
  'spaces.cancel': 'Cancel',
  'spaces.name': 'Name',
  'spaces.namePlaceholder': 'IT help, Design crits, Onboarding…',
  'spaces.purpose': 'What it is for',
  'spaces.purposePlaceholder': 'One line, so people know what to ask here',
  'spaces.none': 'No spaces yet',
  'spaces.noneLead':
    'Start one for a topic people keep asking about: IT help, design reviews, how things work here.',
  'spaces.unloaded': 'Spaces could not be loaded. Try again in a moment.',
  'spaces.failed': 'That did not work. Try again.',
  'spaces.threads.one': '{count} thread',
  'spaces.threads.other': '{count} threads',
  'spaces.active': 'active {when}',
  'spaces.helpful': 'Most helpful',
  'spaces.over': 'Over',
  'spaces.period.week': 'This week',
  'spaces.period.month': 'This month',
  'spaces.period.all': 'All time',
  'spaces.nobody': 'Nobody yet. Mark a reply Helpful and the person who wrote it shows here.',
  'spaces.topReplies': 'Replies that helped most',
  'spaces.helpfulCount': '{count} helpful',
  'spaces.answers.one': '{count} answer',
  'spaces.answers.other': '{count} answers',
  'spaces.theAnswer': 'the answer',
  'spaces.inSpace': '{name} in {space}',
  'spaces.someone': 'Someone',
};

export type MessageKey = keyof typeof en;
