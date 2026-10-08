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

/** Longest a single chat message may be. Generous: chat is where people paste. */
export const MESSAGE_MAX_LENGTH = 4000;

/** Channel names are short because they are read as `#name` in a sidebar. */
export const CHANNEL_NAME_MAX_LENGTH = 48;

/** A page of chat history. Enough to fill a tall screen in one round trip. */
export const MESSAGE_PAGE_SIZE = 50;

/** Bounds on a meeting length, in minutes: a quarter hour to a full day. */
export const MEETING_MIN_MINUTES = 15;
export const MEETING_MAX_MINUTES = 60 * 24;
