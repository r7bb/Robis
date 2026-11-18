/**
 * A new VAPID key pair for web push (C3): `bun run push:keys`.
 *
 * Prints the three variables to set. The private key is a secret: put it
 * in the worker's environment (a secret store in production), never in the
 * repository. The public key goes to the API too, which hands it to
 * browsers. Changing the pair later means every device subscribes again.
 */
import { generateVapidKeys } from '@robis/worker/push';

const keys = await generateVapidKeys();
process.stdout.write(
  [
    `VAPID_PUBLIC_KEY=${keys.publicKey}`,
    `VAPID_PRIVATE_KEY=${keys.privateKey}`,
    'VAPID_SUBJECT=mailto:you@example.com',
    '',
  ].join('\n'),
);
