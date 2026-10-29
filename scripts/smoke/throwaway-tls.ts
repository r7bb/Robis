/**
 * A throwaway certificate authority and certificate for the production-mode
 * stack in CI: `bun run scripts/smoke/throwaway-tls.ts`.
 *
 * Writes `deploy/.tls/` (ignored by git): `ca.pem`, and `cert.pem` with
 * `key.pem` for localhost, 127.0.0.1 and the mail sink's name on the
 * stack's network. The edge proxy serves HTTPS with it, the mail sink
 * offers STARTTLS with it, and the worker and the smoke tests trust `ca.pem`
 * through NODE_EXTRA_CA_CERTS. Nothing here is trusted anywhere else: the
 * key is made fresh on each run and never leaves the machine.
 */
import { mkdir } from 'node:fs/promises';

const DIR = new URL('../../deploy/.tls/', import.meta.url).pathname;
await mkdir(DIR, { recursive: true });

function openssl(...args: string[]) {
  const run = Bun.spawnSync(['openssl', ...args], { cwd: DIR, stderr: 'pipe' });
  if (run.exitCode !== 0) throw new Error(`openssl ${args[0]}: ${run.stderr.toString()}`);
}

openssl(
  'req',
  '-x509',
  '-newkey',
  'rsa:2048',
  '-nodes',
  '-days',
  '2',
  '-subj',
  '/CN=Robis throwaway CA',
  '-keyout',
  'ca-key.pem',
  '-out',
  'ca.pem',
);
openssl(
  'req',
  '-newkey',
  'rsa:2048',
  '-nodes',
  '-subj',
  '/CN=localhost',
  '-keyout',
  'key.pem',
  '-out',
  'cert.csr',
);
await Bun.write(
  `${DIR}san.ext`,
  'subjectAltName=DNS:localhost,DNS:mail,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n',
);
openssl(
  'x509',
  '-req',
  '-in',
  'cert.csr',
  '-CA',
  'ca.pem',
  '-CAkey',
  'ca-key.pem',
  '-CAcreateserial',
  '-days',
  '2',
  '-extfile',
  'san.ext',
  '-out',
  'cert.pem',
);
// Readable by the containers' unprivileged users.
Bun.spawnSync(['chmod', '644', 'key.pem', 'cert.pem', 'ca.pem'], { cwd: DIR });
process.stdout.write(`Throwaway TLS written to ${DIR}\n`);
