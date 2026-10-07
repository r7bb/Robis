/**
 * Numbers the client and the server must agree on.
 *
 * A separate module with no imports, exposed as `@relay/shared/limits`. The
 * package barrel pulls in the Zod schemas, and importing it from a client
 * component to read two integers added ~27kB of JavaScript to every page that
 * did. The schemas read these back, so there is still one source of truth.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

/** Short: a live reset link is a standing takeover risk. */
export const PASSWORD_RESET_TTL_MINUTES = 30;

/** Longer: a welcome message can reasonably sit unread for a day. */
export const EMAIL_VERIFICATION_TTL_MINUTES = 24 * 60;
