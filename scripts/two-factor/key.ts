/**
 * A new key for two-factor sign-in (C4): `bun run two-factor:key`.
 *
 * Prints the one variable to set on the API. It seals every account's
 * authenticator secret, so keep it in a secret store and never in the
 * repository; losing or changing it later locks out everyone who turned
 * two-factor on until they use a recovery code.
 */
import { newSecretKey } from '@robis/auth';

process.stdout.write(`TWO_FACTOR_KEY=${newSecretKey()}\n`);
