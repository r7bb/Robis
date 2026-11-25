/**
 * Who and where a request names (Sapha, tier 0): a person by name and a
 * board by name or key, read the way people say them. One match is the
 * answer; none or several is a question back, never a guess.
 */

type Person = { userId: string; name: string; kind: 'human' | 'agent' };
type Board = { id: string; key: string; name: string; archived: boolean };

export type Found<T> = { ok: true; value: T } | { ok: false; reason: string };

const fold = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Exact name first, then a first name, then the start of a name. */
export function findPerson(
  people: readonly Person[],
  said: string,
  myId: string | null,
): Found<Person> {
  const humans = people.filter((person) => person.kind === 'human');
  if (fold(said) === 'me') {
    const me = humans.find((person) => person.userId === myId);
    return me ? { ok: true, value: me } : { ok: false, reason: 'Not sure who you are yet.' };
  }
  const name = fold(said);
  for (const test of [
    (person: Person) => fold(person.name) === name,
    (person: Person) => fold(person.name).split(' ')[0] === name,
    (person: Person) => fold(person.name).startsWith(name),
  ]) {
    const matches = humans.filter(test);
    if (matches.length === 1) return { ok: true, value: matches[0]! };
    if (matches.length > 1) {
      return {
        ok: false,
        reason: `More than one ${said} here: ${matches.map((p) => p.name).join(', ')}. Say the full name.`,
      };
    }
  }
  return { ok: false, reason: `No one called ${said} in this workspace.` };
}

/** A board by its name or key; with none named, the only open board. */
export function findBoard(boards: readonly Board[], said: string | null): Found<Board> {
  const open = boards.filter((board) => !board.archived);
  if (!said) {
    if (open.length === 1) return { ok: true, value: open[0]! };
    return open.length === 0
      ? { ok: false, reason: 'There is no board here yet.' }
      : { ok: false, reason: 'Which board? Add “on” and its name, like: on Web.' };
  }
  const name = fold(said);
  const match =
    open.find((board) => fold(board.name) === name || fold(board.key) === name) ??
    open.find((board) => fold(board.name).startsWith(name));
  return match ? { ok: true, value: match } : { ok: false, reason: `No board called ${said}.` };
}

/**
 * One of `noun`s by its name, or the start of a name only one has; several
 * that start the same, or none, is a question back. Given several ways of
 * saying it ("3", "cycle 3"), the first that finds one wins.
 */
export function findNamed<T extends { name: string }>(
  items: readonly T[],
  said: string | readonly string[],
  noun: string,
): Found<T> {
  const ways = typeof said === 'string' ? [said] : said;
  let first: Found<T> | null = null;
  for (const way of ways) {
    const found = findNamedOnce(items, way, noun);
    if (found.ok) return found;
    first ??= found;
  }
  return first ?? { ok: false, reason: `No ${noun} named.` };
}

function findNamedOnce<T extends { name: string }>(
  items: readonly T[],
  said: string,
  noun: string,
): Found<T> {
  const name = fold(said);
  const exact = items.find((item) => fold(item.name) === name);
  if (exact) return { ok: true, value: exact };
  const starting = items.filter((item) => fold(item.name).startsWith(name));
  if (starting.length === 1) return { ok: true, value: starting[0]! };
  if (starting.length > 1) {
    return {
      ok: false,
      reason: `More than one ${noun} starts with ${said}: ${starting.map((t) => t.name).join(', ')}. Say more of its name.`,
    };
  }
  return { ok: false, reason: `No ${noun} called ${said}.` };
}

/** A template by its name, as `findNamed` finds one; none points at where they come from. */
export function findTemplate<T extends { name: string }>(
  templates: readonly T[],
  said: string,
): Found<T> {
  const found = findNamed(templates, said, 'template');
  return found.ok || found.reason.startsWith('More')
    ? found
    : { ok: false, reason: `No template called ${said}. Save one from an issue first.` };
}
