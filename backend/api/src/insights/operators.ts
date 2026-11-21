/**
 * The people who run the server (Phase 6), from HEALTH_OPERATORS: exact
 * addresses, or `@domain` for every address there. Anyone can sign up and
 * own a workspace, so owning one is not running the server.
 */

/** The configured entries, trimmed and lower-cased; blanks dropped. */
export function operatorsFrom(raw: string): readonly string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 1);
}

/** Whether an address is one of them, by exact match or by its domain. */
export function isOperator(operators: readonly string[], email: string): boolean {
  const address = email.toLowerCase();
  const domain = address.slice(address.lastIndexOf('@'));
  return operators.some((entry) => (entry.startsWith('@') ? entry === domain : entry === address));
}
