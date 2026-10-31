import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { UPLOADS_PER_MINUTE as AVATAR_UPLOADS_PER_MINUTE } from '@robis/api/avatars';
import {
  ImagesBusyError,
  MAX_CONCURRENT_DECODES,
  MAX_WAITING_DECODES,
  withDecodeSlot,
} from '@robis/api/images';
import sharp from 'sharp';
import { closeHarness, createActor, request, resetDatabase } from './harness.ts';

/**
 * Image decoding is capped (stage 3, item 31): a freed slot goes straight to
 * the next in line, so the cap is never passed, and the line itself is
 * bounded, so a flood of uploads is told to come back rather than queued
 * without end.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

/**
 * Let everything held finish. Only work holding a slot has registered its
 * release; each release hands the slot on, and the next one registers.
 */
async function drain(release: (() => void)[], held: Promise<unknown>[]) {
  let released = 0;
  while (released < held.length) {
    while (released < release.length) release[released++]!();
    await Bun.sleep(1);
  }
  await Promise.all(held);
}

describe('decode slots', () => {
  test('peak concurrency never passes the cap, however the work overlaps', async () => {
    let running = 0;
    let peak = 0;
    const work = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await Bun.sleep(Math.random() * 3);
      running -= 1;
    };
    // Each finished decode immediately asks for another, in the same tick a
    // slot is freed: the moment a slot could be taken twice.
    const chain = async (left: number): Promise<void> => {
      if (left === 0) return;
      await withDecodeSlot(work).catch(() => {});
      return chain(left - 1);
    };
    await Promise.all(Array.from({ length: MAX_CONCURRENT_DECODES + 3 }, () => chain(20)));
    expect(peak).toBe(MAX_CONCURRENT_DECODES);
  });

  test('a full line is refused at once, not queued', async () => {
    const release: (() => void)[] = [];
    const held = Array.from({ length: MAX_CONCURRENT_DECODES + MAX_WAITING_DECODES }, () =>
      withDecodeSlot(() => new Promise<void>((resolve) => release.push(resolve))),
    );
    await Bun.sleep(10);

    await expect(withDecodeSlot(async () => 'never')).rejects.toBeInstanceOf(ImagesBusyError);

    await drain(release, held);
  });
});

describe('an upload while every slot and place in line is taken', () => {
  test('is told to come back, with Retry-After, rather than waiting', async () => {
    const actor = await createActor('Uploader');
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#0a7' },
    })
      .png()
      .toBuffer();

    const release: (() => void)[] = [];
    const held = Array.from({ length: MAX_CONCURRENT_DECODES + MAX_WAITING_DECODES }, () =>
      withDecodeSlot(() => new Promise<void>((resolve) => release.push(resolve))),
    );
    await Bun.sleep(10);
    try {
      const response = await request('/auth/me/avatar', {
        method: 'PUT',
        actor,
        headers: { 'content-type': 'image/png' },
        payload: png,
      });
      expect(response.statusCode).toBe(503);
      expect(response.headers['retry-after']).toBeDefined();
      expect(response.json().error).toBe('images_busy');
    } finally {
      await drain(release, held);
    }
  });
});

describe('the upload limit', () => {
  test('is checked with the size, before the body is received: the next upload is a 429', async () => {
    const actor = await createActor('Busy');
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#a70' } })
      .png()
      .toBuffer();
    const upload = () =>
      request('/auth/me/avatar', {
        method: 'PUT',
        actor,
        headers: { 'content-type': 'image/png' },
        payload: png,
      });

    // Making the account already chose a picture, which counts toward the same limit.
    for (let i = 1; i < AVATAR_UPLOADS_PER_MINUTE; i++) {
      expect((await upload()).statusCode).toBe(200);
    }
    const refused = await upload();
    expect(refused.statusCode).toBe(429);
    expect(refused.headers['retry-after']).toBeDefined();
  });
});
