/**
 * Which environment a service runs in, stated rather than guessed.
 *
 * Every service and CLI used to treat a missing NODE_ENV as development:
 * local defaults for the database role, the audit key, the mailer and the
 * cookies. A production process started without it would quietly run on
 * those. So nothing defaults any more; each entry point calls this first
 * and refuses to start without one of the three names.
 */
export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export function requireNodeEnv(value: string | undefined): NodeEnv {
  if (value !== undefined && (NODE_ENVS as readonly string[]).includes(value)) {
    return value as NodeEnv;
  }
  throw new Error(
    `NODE_ENV must be set to development, test or production; got ${
      value === undefined ? 'nothing' : JSON.stringify(value)
    }. Refusing to start rather than guess: an unset NODE_ENV used to mean development defaults.`,
  );
}
