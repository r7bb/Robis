'use client';

import { Chapter, ChapterTitle } from './chapter.tsx';
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
 * Laid out as a chapter (see `chapter.tsx`), so it shares the page's
 * near-black and its white hairline rules, and sits on the theme-test
 * allowlist with the other landing chapters.
 */

type Bubble = { from: 'them' | 'you'; text: string };

const THREAD: Bubble[] = [
  { from: 'them', text: 'did you ever send me that spec' },
  { from: 'you', text: 'robised it over this morning' },
  { from: 'them', text: 'i’m on the train, nothing’s loading' },
  { from: 'you', text: 'doesn’t matter. open it and type, it’ll sync when you surface' },
  { from: 'them', text: 'huh. it just let me edit' },
];

/** The forms people actually reach for. Lowercase on purpose: a verb is not a logo. */
const PHRASES = [
  'robis it over',
  'it’s on Robis',
  'i’ll robis you the doc',
  'robised it, check the board',
];

const THEM = 'self-start rounded-2xl rounded-bl-md border border-line bg-surface text-content';
const YOU = 'self-end rounded-2xl rounded-br-md bg-accent text-accent-contrast';

export function SayIt() {
  return (
    <Chapter>
      <div className="grid gap-[clamp(2.5rem,5vw,5rem)] lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-5">
          <ChapterTitle aside="Two syllables, and it already sounds conjugated. The shape a word needs to survive being texted.">
            Say it like a verb.
          </ChapterTitle>

          <Reveal delay={200}>
            <ul className="mt-8 flex flex-wrap gap-2.5">
              {PHRASES.map((phrase) => (
                <li
                  key={phrase}
                  className="rounded-full border border-white/10 px-4 py-1.5 text-sm text-muted"
                >
                  {phrase}
                </li>
              ))}
            </ul>

            {/*
              Where the name comes from. A portfolio project can afford to say
              this plainly, and a name with a reason behind it is easier to
              remember than one chosen because the domain was free.

              The name never breaks across lines: "Rohit" on one line and
              "Biju." alone on the next read as two people. Each sentence is
              kept whole too, so on a phone the break falls between them.
            */}
            <p className="mt-8 max-w-[60ch] text-balance text-sm leading-relaxed text-faint">
              <span className="whitespace-nowrap">
                <span translate="no" className="text-muted">
                  Robis
                </span>
                , said <span className="text-muted">ROH-biss</span>.
              </span>{' '}
              <span className="whitespace-nowrap">
                Built by, and named for, <span className="text-muted">Rohit Biju</span>.
              </span>
            </p>
          </Reveal>
        </div>

        <Reveal delay={120} className="lg:col-span-6 lg:col-start-7">
          <div className="flex flex-col gap-2.5">
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
      </div>
    </Chapter>
  );
}
