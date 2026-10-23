/**
 * Create an account (or reuse an existing one) and make it OWNER of every
 * workspace in the database.
 *
 *   bun run scripts/grant-owner.ts rohit@robis.test "Rohit Biju" my-password
 *
 * Password is optional for an account that already exists; supplying one resets
 * it. Intended for local development and for bootstrapping the first admin on a
 * fresh deployment, where there is no one to invite you yet.
 */
import { hashPassword } from '@robis/auth';
import { createDatabase, users, workspaceMembers, workspaces } from '@robis/database';
import { DEMO_PASSWORD, usernameProblem } from '@robis/shared';
import { loadConfig } from '@robis/shared/config';
import { eq } from 'drizzle-orm';

// Before anything else, and failing closed: see `loadConfig`.
const { databaseUrl: DATABASE_URL, nodeEnv } = loadConfig();

const [emailArg, nameArg, passwordArg] = process.argv.slice(2);

if (!emailArg) {
  console.error('Usage: bun run scripts/grant-owner.ts <email> [name] [password]');
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();
const name = nameArg?.trim() || email.split('@')[0]!;
// The same derivation the usernames migration uses for existing accounts:
// trimmed to the allowed characters, then numbered until it is valid and
// free (see `freeUsername` below). Only used when the account is new; an
// existing one keeps its username.
const usernameBase =
  email
    .split('@')[0]!
    .replace(/[^a-z0-9._]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 24)
    .replace(/[._]+$/g, '') || 'member';
// No default in production: there the demo password would be refused at
// sign-in, leaving an owner account nobody can open.
if (!passwordArg && nodeEnv === 'production') {
  console.error('grant-owner needs an explicit password when NODE_ENV=production.');
  process.exit(1);
}
const password = passwordArg ?? DEMO_PASSWORD;

const { db, close } = createDatabase(DATABASE_URL);

try {
  const passwordHash = await hashPassword(password);

  async function freeUsername(): Promise<string> {
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? usernameBase : `${usernameBase}${n}`;
      if (usernameProblem(candidate)) continue;
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, candidate))
        .limit(1);
      if (!taken) return candidate;
    }
  }

  const username = await freeUsername();

  // Upsert so the script is safe to re-run; an existing account keeps its id
  // (and therefore its issues and comments) and just gets a new password.
  const [user] = await db
    .insert(users)
    // No consent is recorded here: an operator cannot agree on someone's
    // behalf, so the account is asked at its first sign-in.
    .values({ email, name, username, passwordHash })
    .onConflictDoUpdate({ target: users.email, set: { name, passwordHash, updatedAt: new Date() } })
    .returning({ id: users.id, email: users.email, name: users.name });

  const allWorkspaces = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces);

  for (const workspace of allWorkspaces) {
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: user!.id, role: 'OWNER' })
      .onConflictDoUpdate({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
        set: { role: 'OWNER' },
      });
  }

  console.log(
    `${user!.name} <${user!.email}> is now OWNER of ${allWorkspaces.length} workspace(s):`,
  );
  for (const workspace of allWorkspaces) console.log(`  - ${workspace.name}`);
  console.log(`\nPassword: ${password}`);
} finally {
  await close();
}
