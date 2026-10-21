import { verifyPassword } from '@robis/auth';
import { type Database, users } from '@robis/database';
import { eq } from 'drizzle-orm';
import { ApiError } from './errors.ts';

/**
 * Ask for the password again before something that cannot be undone:
 * deleting a workspace, deleting the account. A session is enough to work
 * in Robis; it is not enough to destroy it, because a session is exactly
 * what is left behind on a borrowed or stolen laptop.
 *
 * Argon2 makes each check expensive by design, so the routes that call
 * this are rate limited like sign-in.
 */
export async function confirmPassword(db: Database, userId: string, password: string) {
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || !(await verifyPassword(row.passwordHash, password))) {
    throw new ApiError(403, 'password_incorrect', 'That password is not right');
  }
}
