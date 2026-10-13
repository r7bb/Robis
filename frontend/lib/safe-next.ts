/** Stands in for this site's origin, so a relative path can be parsed. */
const HERE = 'http://robis.invalid';

/**
 * Tab, newline and other control characters, which browsers strip from
 * URLs, and the backslash, which they read as a slash.
 */
function hasUnsafeCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || character === '\\') return true;
  }
  return false;
}

/**
 * Where to go after the welcome step. Only a path on this site: a `next`
 * that pointed elsewhere would turn the page into an open redirect.
 *
 * Parsed rather than pattern-matched. A browser drops tabs and newlines
 * before resolving a URL, so "/\t/evil.example" looks local to a prefix
 * check and resolves to another site; resolving it against a stand-in
 * origin and checking the origin survived catches that and every variant.
 */
export function safeNext(raw: string | null): string {
  const fallback = '/workspaces';
  if (!raw?.startsWith('/') || hasUnsafeCharacter(raw)) return fallback;

  try {
    const url = new URL(raw, HERE);
    if (url.origin !== HERE) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
