import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from 'node:crypto';
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';

/**
 * A software authenticator for the passkey tests (C4): a real P-256 key,
 * real CBOR, real signatures, so the server's verifier checks exactly what
 * a phone or laptop would send. Not a mock of the verifier.
 */

const ORIGIN = 'http://localhost:3000';
const RP_ID = 'localhost';

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_DATA = 0x40;

const sha256 = (data: Uint8Array) => new Uint8Array(createHash('sha256').update(data).digest());
const b64url = (data: Uint8Array) => isoBase64URL.fromBuffer(new Uint8Array(data));

function counterBytes(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
}

function coseKeyOf(publicKey: KeyObject): Uint8Array {
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  return isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, isoBase64URL.toBuffer(jwk.x)],
      [-3, isoBase64URL.toBuffer(jwk.y)],
    ]),
  );
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export type SoftKey = {
  credentialId: Uint8Array;
  userHandle: string | null;
  register(challenge: string, options?: { verified?: boolean; origin?: string }): unknown;
  signIn(
    challenge: string,
    options?: { verified?: boolean; counter?: number; origin?: string },
  ): unknown;
};

/** A new passkey, held in memory: register it, then sign in with it. */
export function softPasskey(): SoftKey {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialId = new Uint8Array(randomBytes(32));
  let uses = 0;
  const key: SoftKey = {
    credentialId,
    userHandle: null,

    register(challenge, { verified = true, origin = ORIGIN } = {}) {
      const clientData = new TextEncoder().encode(
        JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }),
      );
      const flags = FLAG_USER_PRESENT | FLAG_ATTESTED_DATA | (verified ? FLAG_USER_VERIFIED : 0);
      const idLength = new Uint8Array([credentialId.length >> 8, credentialId.length & 0xff]);
      const authData = concat(
        sha256(new TextEncoder().encode(RP_ID)),
        new Uint8Array([flags]),
        counterBytes(0),
        new Uint8Array(16), // aaguid: none
        idLength,
        credentialId,
        coseKeyOf(publicKey),
      );
      const attestationObject = isoCBOR.encode(
        new Map<string, unknown>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ]) as never,
      );
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: b64url(clientData),
          attestationObject: b64url(attestationObject),
          transports: ['internal'],
        },
        clientExtensionResults: {},
      };
    },

    signIn(challenge, { verified = true, counter, origin = ORIGIN } = {}) {
      uses += 1;
      const clientData = new TextEncoder().encode(
        JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }),
      );
      const flags = FLAG_USER_PRESENT | (verified ? FLAG_USER_VERIFIED : 0);
      const authData = concat(
        sha256(new TextEncoder().encode(RP_ID)),
        new Uint8Array([flags]),
        counterBytes(counter ?? uses),
      );
      const signature = sign('sha256', concat(authData, sha256(clientData)), privateKey);
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: b64url(clientData),
          authenticatorData: b64url(authData),
          signature: b64url(new Uint8Array(signature)),
          ...(key.userHandle ? { userHandle: key.userHandle } : {}),
        },
        clientExtensionResults: {},
      };
    },
  };
  return key;
}
