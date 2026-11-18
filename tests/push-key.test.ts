import { describe, expect, test } from 'bun:test';
import { applicationServerKey } from '@robis/web/lib/push-key.ts';

/** The push key as a browser subscribes with it (C3). */
describe('applicationServerKey', () => {
  test('decodes base64url, with or without padding', () => {
    const bytes = new Uint8Array([4, 250, 251, 252, 253, 254, 255, 0, 1]);
    const encoded = Buffer.from(bytes).toString('base64url');
    expect([...applicationServerKey(encoded)]).toEqual([...bytes]);
    expect([...applicationServerKey(`${encoded}=`.replace(/=+$/, ''))]).toEqual([...bytes]);
  });
});
