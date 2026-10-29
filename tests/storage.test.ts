import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localDiskStorage, type MediaStorage, s3Storage } from '@robis/storage';

/**
 * One contract, every driver.
 *
 * Local disk always runs. The S3 driver runs against a small in-process
 * stand-in on every run, which checks the requests it forms, and against a
 * real S3-compatible server whenever `S3_ENDPOINT` is set -- which CI does,
 * with an S3Mock service container. Without it, that block says it skipped
 * rather than passing silently.
 */

async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function contract(name: string, make: () => MediaStorage) {
  describe(`storage contract: ${name}`, () => {
    test('what is put can be opened, byte for byte, with its size', async () => {
      const storage = make();
      const bytes = crypto.getRandomValues(new Uint8Array(4096));

      await storage.put('attachments/ws-1/item-1.png', bytes, 'image/png');
      const object = await storage.open('attachments/ws-1/item-1.png');

      expect(object?.size).toBe(4096);
      expect(await bytesOf(object!.stream)).toEqual(bytes);
    });

    test('exists and open agree, before and after a delete', async () => {
      const storage = make();
      const key = 'avatars/gone-soon.webp';

      await storage.put(key, new Uint8Array([1, 2, 3]), 'image/webp');
      expect(await storage.exists(key)).toBe(true);

      await storage.delete(key);
      expect(await storage.exists(key)).toBe(false);
      expect(await storage.open(key)).toBeNull();
    });

    test('deleting something that is not there is not an error', async () => {
      await make().delete('avatars/never-existed.webp');
    });

    test('a key outside the server-made shape is refused, so nothing can escape', async () => {
      const storage = make();
      for (const key of ['../etc/passwd', 'avatars/../../x.png', 'no-folder.png', 'a/B.png', '']) {
        await expect(storage.put(key, new Uint8Array([1]), 'image/png')).rejects.toThrow(
          'invalid media key',
        );
        await expect(storage.open(key)).rejects.toThrow('invalid media key');
      }
    });
  });
}

contract('local disk', () => localDiskStorage(mkdtempSync(join(tmpdir(), 'robis-store-'))));

/**
 * A minimal path-style S3 endpoint: PUT, GET, HEAD and DELETE on
 * `/<bucket>/<key>`. It checks only that requests are shaped as S3 expects
 * (the bucket in the path, a signed Authorization header), not signatures.
 */
const objects = new Map<string, { body: Uint8Array; type: string }>();
const requests: { method: string; path: string; signed: boolean }[] = [];

const standIn = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);
    requests.push({
      method: req.method,
      path,
      signed: (req.headers.get('authorization') ?? '').startsWith('AWS4-HMAC-SHA256'),
    });

    const found = objects.get(path);
    switch (req.method) {
      case 'PUT':
        objects.set(path, {
          body: new Uint8Array(await req.arrayBuffer()),
          type: req.headers.get('content-type') ?? 'application/octet-stream',
        });
        return new Response(null, { status: 200, headers: { etag: '"x"' } });
      case 'HEAD':
        return found
          ? new Response(null, {
              status: 200,
              headers: {
                'content-length': String(found.body.byteLength),
                'content-type': found.type,
                etag: '"x"',
                'last-modified': new Date().toUTCString(),
              },
            })
          : new Response(null, { status: 404 });
      case 'GET':
        return found
          ? new Response(Buffer.from(found.body), { headers: { 'content-type': found.type } })
          : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
      case 'DELETE':
        objects.delete(path);
        return new Response(null, { status: 204 });
      default:
        return new Response(null, { status: 405 });
    }
  },
});

afterAll(() => standIn.stop(true));

const standInOptions = {
  endpoint: `http://127.0.0.1:${standIn.port}`,
  bucket: 'robis-test',
  accessKeyId: 'test',
  secretAccessKey: 'test-secret',
  region: 'us-east-1',
};

contract('S3 driver against a local stand-in', () => s3Storage(standInOptions));

describe('the S3 driver speaks S3', () => {
  test('requests are path-style, inside the bucket, and signed', async () => {
    requests.length = 0;
    await s3Storage(standInOptions).put('attachments/w/one.png', new Uint8Array([7]), 'image/png');

    const put = requests.find((r) => r.method === 'PUT');
    expect(put?.path).toBe('/robis-test/attachments/w/one.png');
    expect(put?.signed).toBe(true);
    expect(objects.get('/robis-test/attachments/w/one.png')?.type).toBe('image/png');
  });
});

const realEndpoint = process.env.S3_ENDPOINT;

if (realEndpoint) {
  contract(`S3 driver against ${realEndpoint}`, () =>
    s3Storage({
      endpoint: realEndpoint,
      bucket: process.env.S3_BUCKET ?? 'robis-test',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'test',
      region: process.env.S3_REGION ?? 'us-east-1',
    }),
  );
} else {
  describe('storage contract: a real S3-compatible server', () => {
    test.skip('skipped: set S3_ENDPOINT (CI runs these against S3Mock)', () => {});
  });
}
