import { z } from 'zod';

/**
 * Profile pictures, as the API describes them.
 *
 * A photo is fetched from the API, which checks who is asking; a generated
 * avatar is drawn by the client from its seed, so it needs no request and
 * reveals nothing. Null means the person has not chosen one yet.
 */
export type Avatar = { kind: 'photo'; url: string } | { kind: 'generated'; seed: string } | null;

/** Short, URL-safe, and only ever used to pick colours and a pattern. */
export const AVATAR_SEED = /^[a-z0-9-]{1,32}$/;

export const generatedAvatarSchema = z.object({
  seed: z.string().regex(AVATAR_SEED, 'A seed is 1 to 32 lowercase letters, digits or dashes'),
});
export type GeneratedAvatarInput = z.infer<typeof generatedAvatarSchema>;
