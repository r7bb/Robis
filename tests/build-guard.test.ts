import { describe, expect, test } from 'bun:test';
import { localEndpoints } from '../frontend/lib/build-guard.ts';

/**
 * One web image runs everywhere because it uses relative addresses
 * (stage 1, item 3). A production build that bakes in a localhost address
 * would work on the build machine and nowhere else, so it is refused.
 */

describe('a production build', () => {
  test('accepts the relative defaults', () => {
    expect(localEndpoints({})).toEqual([]);
    expect(localEndpoints({ NEXT_PUBLIC_API_URL: '' })).toEqual([]);
  });

  test('accepts a real address', () => {
    expect(
      localEndpoints({
        NEXT_PUBLIC_API_URL: 'https://robis.example/api',
        NEXT_PUBLIC_REALTIME_URL: 'wss://robis.example/ws',
      }),
    ).toEqual([]);
  });

  test('names every override that points at this machine', () => {
    expect(
      localEndpoints({
        NEXT_PUBLIC_API_URL: 'http://localhost:4000',
        NEXT_PUBLIC_REALTIME_URL: 'ws://127.0.0.1:4001/ws',
      }),
    ).toEqual(['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_REALTIME_URL']);
    expect(localEndpoints({ NEXT_PUBLIC_API_URL: 'http://[::1]:4000' })).toEqual([
      'NEXT_PUBLIC_API_URL',
    ]);
  });

  test('refuses other spellings of this machine, plain http, and a bare host:port', () => {
    for (const value of [
      'https://127.1/api',
      'https://0x7f.1/api',
      'https://app.localhost/api',
      'https://[::ffff:127.0.0.1]/api',
      'http://robis.example/api',
      'localhost:4000',
    ]) {
      expect(localEndpoints({ NEXT_PUBLIC_API_URL: value })).toEqual(['NEXT_PUBLIC_API_URL']);
    }
    expect(localEndpoints({ NEXT_PUBLIC_API_URL: '/api' })).toEqual([]);
  });
});
