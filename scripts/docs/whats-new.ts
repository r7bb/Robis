/**
 * The README's Latest and docs/WHATS_NEW.md, written from the changelog.
 *
 *   bun run docs:whats-new           rewrite both
 *   bun run docs:whats-new --check   fail if either is out of date
 *
 * `frontend/features/landing/changelog.ts` is the one source for what has
 * shipped (stage 4, item 36). Each list sits between a pair of markers, and
 * only what is between them is written; the text around stays by hand.
 * `tests/changelog.test.ts` runs the same check, so CI refuses a changelog
 * entry whose lists were not regenerated.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CHANGELOG, type Entry } from '@robis/web/features/landing/changelog.ts';

/** How many of the newest entries the README itself shows. */
export const README_LATEST = 3;
/** Where the lists wrap, matching the hand-written Markdown around them. */
const WIDTH = 76;
const INDENT = '  ';

const ROOT = resolve(import.meta.dir, '../..');
export const README = join(ROOT, 'README.md');
export const WHATS_NEW = join(ROOT, 'docs/WHATS_NEW.md');

/** A list item, wrapped at `WIDTH` with continuation lines indented. */
function item(text: string): string {
  const lines: string[] = [];
  let line = '-';
  for (const word of text.split(/\s+/)) {
    if (line.length + 1 + word.length > WIDTH) {
      lines.push(line);
      line = `${INDENT}${word}`;
    } else {
      line = `${line} ${word}`;
    }
  }
  return [...lines, line].join('\n');
}

/** The README's few newest entries. */
export function renderLatest(entries: readonly Entry[]): string {
  return entries
    .slice(0, README_LATEST)
    .map((entry) => item(`**${entry.title}.** ${entry.brief}`))
    .join('\n');
}

/** Every entry, newest first, with its date. */
export function renderWhatsNew(entries: readonly Entry[]): string {
  return entries
    .map((entry) => item(`**${entry.title}** (${entry.date}). ${entry.brief}`))
    .join('\n');
}

/** `document` with what is between the `name` markers replaced by `list`. */
export function withList(document: string, name: string, list: string): string {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const from = document.indexOf(start);
  const to = document.indexOf(end);
  if (from === -1 || to < from) throw new Error(`markers ${start} and ${end} not found`);
  return `${document.slice(0, from + start.length)}\n\n${list}\n\n${document.slice(to)}`;
}

/** Each file as the changelog says it should read. */
export function expected(entries: readonly Entry[] = CHANGELOG) {
  return [
    { file: README, text: withList(readFileSync(README, 'utf8'), 'latest', renderLatest(entries)) },
    {
      file: WHATS_NEW,
      text: withList(readFileSync(WHATS_NEW, 'utf8'), 'whats-new', renderWhatsNew(entries)),
    },
  ];
}

if (import.meta.main) {
  const check = process.argv.includes('--check');
  const stale = expected().filter(({ file, text }) => readFileSync(file, 'utf8') !== text);
  if (check) {
    for (const { file } of stale)
      console.error(`${file} is out of date: run bun run docs:whats-new`);
    process.exit(stale.length ? 1 : 0);
  }
  for (const { file, text } of stale) writeFileSync(file, text);
  console.log(stale.length ? `Rewrote ${stale.length} file(s).` : 'Already current.');
}
