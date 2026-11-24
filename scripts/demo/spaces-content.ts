/**
 * What the demo's spaces hold (demo:life): the spaces themselves and the
 * threads people start, each with its kind. Replies are a plain bank of
 * lines in content.ts, with the rest.
 */
/** The spaces the demo keeps: made by whoever first needs one. */
export const SPACES: readonly { name: string; description: string }[] = [
  { name: 'IT help', description: 'Laptops, access, VPN and anything that will not connect' },
  { name: 'Design reviews', description: 'Share a screen early and get eyes on it' },
  { name: 'How we work', description: 'Rituals, tools and the habits that help' },
];

/** Threads people start in a space, each with its kind. */
export const SPACE_THREADS: readonly {
  kind: 'question' | 'idea' | 'discussion' | 'tip';
  title: string;
  body: string;
}[] = [
  {
    kind: 'question',
    title: 'Why does the VPN drop every day around noon?',
    body: 'It reconnects after a minute, but calls freeze while it does.',
  },
  {
    kind: 'question',
    title: 'How do I get access to the staging database?',
    body: 'Read only is fine. Who approves it?',
  },
  {
    kind: 'question',
    title: 'Is there a shared icon set we should be using?',
    body: 'I keep finding three slightly different arrows.',
  },
  {
    kind: 'question',
    title: 'What is the best way to hand over a half finished issue?',
    body: 'Going on leave Friday and want the next person to pick it up cleanly.',
  },
  {
    kind: 'tip',
    title: 'Press ? on the board to see every shortcut',
    body: 'J and K move between cards, Enter opens one. Saves a lot of clicking.',
  },
  {
    kind: 'idea',
    title: 'A fifteen minute demo slot every Friday',
    body: 'Anyone shows anything they made this week. No slides.',
  },
  {
    kind: 'discussion',
    title: 'Do we still need the Monday status meeting?',
    body: 'Check-ins on the feed cover most of it now.',
  },
];
