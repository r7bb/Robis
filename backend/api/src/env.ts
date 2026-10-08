import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default('127.0.0.1'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  /** Session cookies are HTTPS-only unless explicitly relaxed for local dev. */
  COOKIE_SECURE: z
    .string()
    .default('0')
    .transform((v) => v === '1' || v.toLowerCase() === 'true'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Postgres pool size. Every request resolves a session and checks
   * membership before its own query, so this bounds concurrency well below
   * what the connection count suggests.
   */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  /**
   * Per-request logging. On by default; the load harness turns it off so the
   * benchmark measures the server rather than the cost of serializing a log
   * line per request to a pipe.
   */
  /**
   * Reset links per hour per address. The default protects real mailboxes;
   * the screenshot and demo flows raise it because they drive the form
   * repeatedly against one seeded account.
   */
  AUTH_FORGOT_PER_HOUR: z.coerce.number().int().min(1).default(3),
  API_LOG: z
    .string()
    .default('1')
    .transform((v) => v === '1' || v.toLowerCase() === 'true'),
  /**
   * The duplicate-suggestion service. Empty means the feature is off, which
   * is the default: Robis runs perfectly well without it, and a composer
   * that needs a Python process to accept a bug report would be a worse
   * product than one that simply has no hints.
   */
  ML_SERVICE_URL: z.string().default(''),
  ML_SERVICE_TOKEN: z.string().default(''),
  /** Short: this sits between a keystroke and a hint. */
  ML_TIMEOUT_MS: z.coerce.number().int().min(50).max(5000).default(600),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  /*
   * `WEB_ORIGIN` is not only the CORS allowance: it is the origin every
   * mailed reset and verification link is built from. Left at its local
   * default, a production deploy mails `http://localhost:3000` links that
   * nobody can open, over a scheme that would leak the token if they could.
   */
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.WEB_ORIGIN.startsWith('https://')) {
    throw new Error(
      `WEB_ORIGIN must be an https origin in production; got "${parsed.data.WEB_ORIGIN}". ` +
        'It is the origin password-reset links are built from.',
    );
  }

  return parsed.data;
}
