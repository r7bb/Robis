import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readZip, writeZip, ZipError } from '@robis/storage';

/** The export's zip (C6): stored entries, read back exactly, and accepted by unzip. */

const text = (value: string) => new TextEncoder().encode(value);
const entries = [
  { name: 'issues.jsonl', data: text('{"title":"Café menu"}\n') },
  { name: 'files/ünïcode name.png', data: new Uint8Array([0, 1, 2, 255]) },
  { name: 'empty.txt', data: new Uint8Array() },
];

describe('the export zip', () => {
  test('reads back exactly what was written', () => {
    const back = readZip(writeZip(entries), 1_000_000);
    expect(back.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (const [i, entry] of back.entries()) {
      expect([...entry.data]).toEqual([...entries[i]!.data]);
    }
  });

  test('is accepted by the system unzip, checksums and all', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'robis-zip-'));
    try {
      const path = join(dir, 'export.zip');
      await Bun.write(path, writeZip(entries));
      const run = Bun.spawnSync(['unzip', '-t', path]);
      expect(run.stdout.toString()).toContain('No errors detected');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('refuses names that climb out of the archive, either way round', () => {
    for (const name of ['../evil', '/abs', 'a/../../b', 'a\\b']) {
      expect(() => writeZip([{ name, data: text('x') }])).toThrow('Unsafe name');
    }
    const forged = writeZip([{ name: 'aa/evil', data: text('x') }]);
    // Rewrite both copies of the name to "../evil" in place.
    const bytes = Buffer.from(forged).toString('latin1').replaceAll('aa/evil', '../evil');
    expect(() => readZip(Buffer.from(bytes, 'latin1'), 100)).toThrow(ZipError);
  });

  test('refuses a damaged entry, a compressed one, and one over the size allowed', () => {
    const zip = writeZip([{ name: 'a.txt', data: text('hello') }]);
    const damaged = Uint8Array.from(zip);
    const firstByte = 30 + 'a.txt'.length;
    damaged[firstByte] = damaged[firstByte]! ^ 0xff;
    expect(() => readZip(damaged, 100)).toThrow('Checksum mismatch');

    const compressed = Uint8Array.from(zip);
    const centralAt = compressed.length - 22 - 46 - 'a.txt'.length;
    compressed[centralAt + 10] = 8;
    expect(() => readZip(compressed, 100)).toThrow('compressed');

    expect(() => readZip(zip, 4)).toThrow('larger than allowed');
    expect(() => readZip(text('not a zip at all, just words'), 100)).toThrow('Not a zip');
  });

  test('refuses names twice over, odd segments and control characters', () => {
    const twice = writeZip([
      { name: 'Notes.txt', data: text('a') },
      { name: 'notex.txt', data: text('b') },
    ]);
    const forged = Buffer.from(
      Buffer.from(twice).toString('latin1').replaceAll('notex', 'notes'),
      'latin1',
    );
    expect(() => readZip(forged, 100)).toThrow('appears twice');
    for (const name of ['a/./b', 'tab\there', 'C:evil']) {
      expect(() => writeZip([{ name, data: text('x') }])).toThrow('Unsafe name');
    }
  });

  test('refuses a directory that does not end where the end record starts', () => {
    const zip = writeZip([{ name: 'a.txt', data: text('hello') }]);
    const shifted = Uint8Array.from(zip);
    const view = new DataView(shifted.buffer);
    const endAt = shifted.length - 22;
    view.setUint32(endAt + 16, view.getUint32(endAt + 16, true) - 1, true);
    expect(() => readZip(shifted, 100)).toThrow('Damaged zip directory');
  });
});
