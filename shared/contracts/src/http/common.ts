import { z } from 'zod';
import { uuid } from '../schemas.ts';

/** Every route under a workspace names it first. */
export const workspaceParams = z.object({ workspaceId: uuid });

/**
 * A person's picture: a photo served by the API, a generated one the web
 * app draws from its seed, or none yet (see `avatars.ts`).
 */
export const avatar = z.union([
  z.object({ kind: z.literal('photo'), url: z.string() }),
  z.object({ kind: z.literal('generated'), seed: z.string() }),
  z.null(),
]);
