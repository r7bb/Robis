/**
 * A release's notes, written when it ships: what was done in it, grouped by
 * board and in issue order, under its name and the day it shipped. Work
 * still open or canceled is not in the notes.
 */

type Noted = { key: string; title: string; projectName: string; status: string };

const numberOf = (key: string) => Number(key.slice(key.lastIndexOf('-') + 1)) || 0;

export function releaseNotes(release: {
  name: string;
  shippedOn: string;
  issues: readonly Noted[];
}): string {
  const head = `${release.name}, shipped ${release.shippedOn}`;
  const done = release.issues.filter((issue) => issue.status === 'DONE');
  if (done.length === 0) return `${head}\n\nNothing was done in this release.`;
  const boards = [...new Set(done.map((issue) => issue.projectName))].sort((a, b) =>
    a.localeCompare(b),
  );
  const sections = boards.map((board) =>
    [
      board,
      ...done
        .filter((issue) => issue.projectName === board)
        .sort((a, b) => numberOf(a.key) - numberOf(b.key))
        .map((issue) => `- ${issue.key} ${issue.title}`),
    ].join('\n'),
  );
  return [head, ...sections].join('\n\n');
}
