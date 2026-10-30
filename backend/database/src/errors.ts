/**
 * The SQLSTATE code Postgres gave a failed query, or undefined.
 *
 * Drizzle wraps query errors (from 0.44) with the driver's error as the
 * cause, and the driver may wrap again; the code is on whichever error in
 * that chain came from the database. Only five-character SQLSTATE codes
 * count, so another library's `code` (an S3 client's `ERR_...`) is not
 * mistaken for one.
 */
export function pgErrorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && SQLSTATE.test(code)) return code;
    current = cause;
  }
  return undefined;
}

const SQLSTATE = /^[0-9A-Z]{5}$/;

/** Postgres `unique_violation`. */
export const UNIQUE_VIOLATION = '23505';
/** Postgres `foreign_key_violation`. */
export const FOREIGN_KEY_VIOLATION = '23503';
