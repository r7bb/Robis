import { config } from 'zod';

/**
 * In a browser, zod parses without compiling code at runtime.
 *
 * zod builds faster parsers with `new Function`, and first tries one to see
 * whether it may. The web app's security policy allows no eval, so that try
 * is refused and reported as a violation on every page. Imported first by
 * the package index, so it runs before any schema here is built or used.
 * The services, which have no such policy, keep the fast path.
 */
if ('window' in globalThis) config({ jitless: true });
