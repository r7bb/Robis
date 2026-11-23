/**
 * Zip archives, stored without compression (C6): the workspace export is
 * written as one, and the importer reads it back.
 *
 * Only what the export needs: the "stored" method, UTF-8 names, no zip64,
 * so an archive is limited to 65,535 entries and 4 GiB. That keeps it to
 * the three record types of the format, small enough to check by reading,
 * and readable by every unzip tool. Most of an export is JSON text and
 * already-compressed images, so compression would save little.
 *
 * The reader accepts only archives of the same shape and refuses names
 * that climb out of the archive, entries it would have to inflate, and
 * anything larger than the caller allows.
 */

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const UTF8_FLAG = 0x0800;
const VERSION = 20;
const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;
const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

export type ZipEntry = { name: string; data: Uint8Array };

/** MS-DOS time and date fields, which zip uses for modification time. */
function dosTime(at: Date): { time: number; date: number } {
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
    date: ((at.getUTCFullYear() - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

/** The longest name either side accepts; far beyond any the export writes. */
const MAX_NAME = 512;

function hasControlCharacter(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** A relative path of plain segments: nothing that climbs out, hides, or confuses a filesystem. */
function safeName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_NAME &&
    !name.startsWith('/') &&
    !name.includes('\\') &&
    !name.includes(':') &&
    !hasControlCharacter(name) &&
    !name.split('/').some((part) => part === '..' || part === '.' || part === '')
  );
}

/** One archive holding `entries`, in order. */
export function writeZip(entries: readonly ZipEntry[], at = new Date()): Uint8Array {
  if (entries.length > MAX_ENTRIES) throw new Error('Too many entries for a zip without zip64');
  const encoder = new TextEncoder();
  const { time, date } = dosTime(at);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    if (!safeName(entry.name)) throw new Error(`Unsafe name in zip: ${entry.name}`);
    const name = encoder.encode(entry.name);
    const crc = Bun.hash.crc32(entry.data);
    const size = entry.data.byteLength;

    const local = new DataView(new ArrayBuffer(LOCAL_HEADER));
    local.setUint32(0, LOCAL, true);
    local.setUint16(4, VERSION, true);
    local.setUint16(6, UTF8_FLAG, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.byteLength, true);
    local.setUint16(28, 0, true);

    const central = new DataView(new ArrayBuffer(CENTRAL_HEADER));
    central.setUint32(0, CENTRAL, true);
    central.setUint16(4, VERSION, true);
    central.setUint16(6, VERSION, true);
    central.setUint16(8, UTF8_FLAG, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, name.byteLength, true);
    central.setUint32(42, offset, true);

    locals.push(new Uint8Array(local.buffer), name, entry.data);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += LOCAL_HEADER + name.byteLength + size;
    if (offset > MAX_BYTES) throw new Error('Archive too large for a zip without zip64');
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(END_RECORD));
  end.setUint32(0, END, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.byteLength;
  }
  return out;
}

export class ZipError extends Error {}

/** Where the end record starts: the last 22 bytes, unless a comment follows it. */
function endRecordAt(bytes: Uint8Array, view: DataView): number {
  const earliest = Math.max(0, bytes.byteLength - 0xffff - END_RECORD);
  for (let i = bytes.byteLength - END_RECORD; i >= earliest; i--) {
    if (view.getUint32(i, true) === END) return i;
  }
  throw new ZipError('Not a zip archive');
}

type DirectoryEntry = {
  name: string;
  method: number;
  crc: number;
  size: number;
  localAt: number;
  next: number;
};

const decoder = new TextDecoder('utf-8', { fatal: true });

function directoryEntry(bytes: Uint8Array, view: DataView, at: number): DirectoryEntry {
  if (at + CENTRAL_HEADER > bytes.byteLength || view.getUint32(at, true) !== CENTRAL) {
    throw new ZipError('Damaged zip directory');
  }
  const nameLength = view.getUint16(at + 28, true);
  const skip = nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  if (at + CENTRAL_HEADER + nameLength > bytes.byteLength) {
    throw new ZipError('Damaged zip directory');
  }
  let name: string;
  try {
    name = decoder.decode(bytes.subarray(at + CENTRAL_HEADER, at + CENTRAL_HEADER + nameLength));
  } catch {
    throw new ZipError('A name in the zip is not UTF-8');
  }
  return {
    name,
    method: view.getUint16(at + 10, true),
    crc: view.getUint32(at + 16, true),
    size: view.getUint32(at + 24, true),
    localAt: view.getUint32(at + 42, true),
    next: at + CENTRAL_HEADER + skip,
  };
}

/** The bytes of one stored entry, checked against its checksum. */
function entryData(bytes: Uint8Array, view: DataView, entry: DirectoryEntry): Uint8Array {
  const { name, localAt, size } = entry;
  if (localAt + LOCAL_HEADER > bytes.byteLength || view.getUint32(localAt, true) !== LOCAL) {
    throw new ZipError(`Damaged entry: ${name}`);
  }
  const dataAt =
    localAt +
    LOCAL_HEADER +
    view.getUint16(localAt + 26, true) +
    view.getUint16(localAt + 28, true);
  if (dataAt + size > bytes.byteLength) throw new ZipError(`Damaged entry: ${name}`);
  const data = bytes.subarray(dataAt, dataAt + size);
  if (Bun.hash.crc32(data) !== entry.crc) throw new ZipError(`Checksum mismatch: ${name}`);
  return data;
}

/**
 * The entries of an archive written by `writeZip` (or any stored, non-zip64
 * zip), refusing more than `maxBytes` of content in total.
 */
export function readZip(bytes: Uint8Array, maxBytes: number): ZipEntry[] {
  if (bytes.byteLength > maxBytes + MAX_ENTRIES * (LOCAL_HEADER + CENTRAL_HEADER + 2 * MAX_NAME)) {
    throw new ZipError('The archive is larger than allowed');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endAt = endRecordAt(bytes, view);
  const count = view.getUint16(endAt + 10, true);
  const directorySize = view.getUint32(endAt + 12, true);
  let at = view.getUint32(endAt + 16, true);
  // The directory must end exactly where the end record starts: a record
  // found inside a comment, or a directory pointing elsewhere, is refused,
  // so this reader and any other unzip see the same entries.
  if (at + directorySize !== endAt) throw new ZipError('Damaged zip directory');
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let total = 0;

  for (let i = 0; i < count; i++) {
    const entry = directoryEntry(bytes, view, at);
    at = entry.next;
    if (entry.method !== 0) {
      throw new ZipError(`${entry.name} is compressed; only stored entries are read`);
    }
    if (entry.name.endsWith('/')) continue;
    if (!safeName(entry.name)) throw new ZipError(`Unsafe name in zip: ${entry.name}`);
    const folded = entry.name.toLowerCase();
    if (seen.has(folded)) throw new ZipError(`A name appears twice in the zip: ${entry.name}`);
    seen.add(folded);
    total += entry.size;
    if (total > maxBytes) throw new ZipError('The archive is larger than allowed');
    entries.push({ name: entry.name, data: entryData(bytes, view, entry) });
  }
  return entries;
}
