'use client';

import { Band, Headline, Subhead } from './band.tsx';
import { Reveal } from './motion.tsx';

/**
 * The name, and how to use it.
 *
 * A product name earns its keep when it survives being typed into a
 * message by someone who is not thinking about branding. "Robis" is two
 * syllables, and it already carries the shape of a conjugated verb --
 * "she robis it over" needs no explaining the first time somebody reads
 * it. That is rarer than it sounds: most names have to be taught before
 * they can be used, and a name nobody can inflect stays a noun forever.
 *
 * Shown as a thread rather than a list of slogans, because the claim is
 * that the word works in conversation, and a conversation is the only
 * honest way to demonstrate that. The exchange also happens to carry the
 * product's one real promise, so the section is not purely decorative.
 *
 * Theme tokens only. The band primitives carry a fixed marketing palette,
 * but nothing here needs to, and staying on tokens keeps this file off
 * the hardcoded-colour allowlist in `tests/themes.test.ts`.
 */

type Bubble = { from: 'them' | 'you'; text: string };

const THREAD: Bubble[] = [
  { from: 'them', text: 'did you ever send me that spec' },
  { from: 'you', text: 'robised it over this morning' },
  { from: 'them', text: 'i’m on the train, nothing’s loading' },
  { from: 'you', text: 'doesn’t matter — open it and type. it’ll sync when you surface' },
  { from: 'them', text: 'huh. it just let me edit' },
];

/** The forms people actually reach for. Lowercase on purpose: a verb is not a logo. */
const PHRASES = [
  'robis it over',
  'it’s on Robis',
  'i’ll robis you the doc',
  'robised it — check the board',
];

const THEM = 'self-start rounded-2xl rounded-bl-md border border-line bg-surface text-content';
const YOU = 'self-end rounded-2xl rounded-br-md bg-accent text-accent-contrast';

export function SayIt() {
  return (
    <Band tone="raised">
      <Reveal>
        <Headline>Say it like a verb.</Headline>
        <Subhead>
          Two syllables, and it already sounds conjugated. The shape a word needs to survive being
          texted.
        </Subhead>
      </Reveal>

      <Reveal delay={80} className="mx-auto mt-[clamp(2.5rem,6vh,4rem)] max-w-md">
        <div className="flex flex-col gap-2.5 text-left">
          {THREAD.map((bubble) => (
            <p
              key={bubble.text}
              className={`max-w-[85%] px-4 py-2.5 text-[0.975rem] leading-snug ${
                bubble.from === 'you' ? YOU : THEM
              }`}
            >
              {bubble.text}
            </p>
          ))}
        </div>
      </Reveal>

      <Reveal delay={160} className="mt-[clamp(2rem,5vh,3rem)]">
        <ul className="flex flex-wrap items-center justify-center gap-2.5">
          {PHRASES.map((phrase) => (
            <li
              key={phrase}
              className="rounded-full border border-line px-4 py-1.5 text-sm text-muted"
            >
              {phrase}
            </li>
          ))}
        </ul>

        {/*
          Where the name comes from. A portfolio project can afford to say
          this plainly, and a name with a reason behind it is easier to
          remember than one chosen because the domain was free.
        */}
        <p className="mx-auto mt-8 max-w-[42ch] text-sm leading-relaxed text-faint">
          <span className="text-muted">Robis</span> — said{' '}
          <span className="text-muted">ROH-biss</span>. Built by, and named for, Rohit Biju.
        </p>
      </Reveal>
    </Band>
  );
}
