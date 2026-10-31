/**
 * Broken relative links in the repository's Markdown.
 *
 *   bun run docs:links
 *
 * Every tracked `.md` file is read, and every relative link and image in it
 * -- inline `[text](path)`, reference-style `[name]: path`, and HTML
 * `src`/`href` -- must point at a file or directory that exists. External
 * URLs, in-page `#anchors` and anything inside code are skipped: the check
 * is for links that a rename or a move silently broke, which is how
 * ARCHITECTURE.md came to point at an `apps/` directory that no longer
 * exists. CI runs this, so it cannot drift that way again.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type BrokenLink = { file: string; line: number; target: string };

/** Lines that are code, so a path shown as an example is not a link. */
function blankOutCode(markdown: string): string {
  return (
    markdown
      // Fenced blocks, keeping their newlines so line numbers still match.
      .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (block) => block.replace(/[^\n]/g, ' '))
      // Inline code spans.
      .replace(/`[^`\n]*`/g, (span) => ' '.repeat(span.length))
  );
}

const PATTERNS = [
  // [text](target "title") and ![alt](target)
  /!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"'\n]*["'])?\s*\)/g,
  // [name]: target
  /^\s{0,3}\[[^\]\n]+\]:\s*<?(\S+?)>?(?:\s|$)/gm,
  // <img src="..."> and <a href="...">
  /\b(?:src|href)="([^"]+)"/g,
];

/** Not something to resolve on disk. */
function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//');
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Every relative link in `files` (paths relative to `root`) that resolves to nothing. */
export function brokenLinks(root: string, files: readonly string[]): BrokenLink[] {
  const broken: BrokenLink[] = [];

  for (const file of files) {
    const text = blankOutCode(readFileSync(join(root, file), 'utf8'));
    const seen = new Set<string>();

    for (const pattern of PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const raw = match[1];
        if (!raw || isExternal(raw)) continue;

        const path = decodeURI(raw.split('#')[0]!.split('?')[0]!);
        if (!path) continue;

        // A leading slash means the repository root, as GitHub renders it.
        const absolute = path.startsWith('/')
          ? join(root, path)
          : resolve(join(root, dirname(file)), path);

        const line = lineOf(text, match.index ?? 0);
        const key = `${line}:${raw}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (!existsSync(absolute)) broken.push({ file, line, target: raw });
      }
    }
  }

  return broken.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/**
 * Repository paths quoted in code spans (`backend/api/src/app.ts`) that do
 * not exist.
 *
 * Only for documents that promise every row names a real file, which is the
 * inventory: elsewhere a quoted path may be a plan (`backend/mcp`) or an
 * example. Paths are matched only under the repository's own top-level
 * directories, so ordinary code like `a/b` is left alone.
 */
const QUOTED_PATH =
  /`((?:backend|frontend|shared|scripts|robis-ml|tests|docs|\.github)\/[^`\s]*)`/g;

export function missingQuotedPaths(root: string, files: readonly string[]): BrokenLink[] {
  const missing: BrokenLink[] = [];

  for (const file of files) {
    const original = readFileSync(join(root, file), 'utf8');
    // Fenced blocks only: inline code is exactly what is being checked.
    const text = original.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (block) =>
      block.replace(/[^\n]/g, ' '),
    );

    for (const match of text.matchAll(QUOTED_PATH)) {
      const path = match[1]!.replace(/[.,;:]+$/, '');
      if (!existsSync(join(root, path))) {
        missing.push({ file, line: lineOf(text, match.index ?? 0), target: path });
      }
    }
  }

  return missing;
}

/** Documents that promise every path they quote is a real file. */
export const INVENTORIES = ['COMPLETE_APP_SUMMARY.md'] as const;

/** Tracked Markdown files, except the checker's own deliberately broken fixtures. */
export function trackedMarkdown(root: string): string[] {
  const listed = Bun.spawnSync(['git', 'ls-files', '*.md'], { cwd: root }).stdout.toString();
  return listed.split('\n').filter((file) => file && !file.startsWith('tests/fixtures/'));
}

/** Every Markdown file under a directory, for checking a fixture tree. */
function markdownUnder(root: string): string[] {
  return [...new Bun.Glob('**/*.md').scanSync({ cwd: root })].sort();
}

if (import.meta.main) {
  /*
   * `--root <dir>` checks a directory tree instead of the repository. CI uses
   * it on the deliberately broken fixture and requires a failure, so the
   * step is shown to catch a broken link rather than assumed to.
   */
  const flag = process.argv.indexOf('--root');
  const fixtureRoot = flag === -1 ? null : process.argv[flag + 1];

  const root = fixtureRoot ? resolve(fixtureRoot) : resolve(import.meta.dir, '..', '..');
  const files = fixtureRoot ? markdownUnder(root) : trackedMarkdown(root);
  const inventories = fixtureRoot ? files.filter((f) => f.includes('inventory')) : INVENTORIES;
  const broken = [...brokenLinks(root, files), ...missingQuotedPaths(root, inventories)];

  if (broken.length === 0) {
    console.log(
      `docs:links: ${files.length} Markdown files, every relative link resolves, and every path the inventory names exists.`,
    );
  } else {
    for (const link of broken) console.error(`${link.file}:${link.line}  ${link.target}`);
    console.error(`\ndocs:links: ${broken.length} broken link(s) or missing path(s).`);
    process.exit(1);
  }
}
