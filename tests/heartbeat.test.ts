import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HEARTBEAT_MAX_AGE_MS, heartbeat, isAlive } from '@robis/worker/heartbeat';

/** The worker container's health check: a file the loop touches. */
describe('worker heartbeat', () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'robis-heartbeat-')), 'beat');

  test('a worker that has never polled is not alive', () => {
    expect(isAlive(file())).toBe(false);
  });

  test('a recent poll is alive, and a stale one is not', () => {
    const path = file();
    heartbeat(path)();

    expect(isAlive(path)).toBe(true);
    expect(isAlive(path, HEARTBEAT_MAX_AGE_MS, Date.now() + HEARTBEAT_MAX_AGE_MS + 1_000)).toBe(
      false,
    );
  });

  test('a burst of polls writes at most once a second', async () => {
    const path = file();
    let clock = 1_000_000;
    const beat = heartbeat(path, () => clock);

    beat();
    const first = await Bun.file(path).text();
    clock += 500;
    beat();
    expect(await Bun.file(path).text()).toBe(first);

    clock += 600;
    beat();
    expect(await Bun.file(path).text()).toBe(String(clock));
  });
});
