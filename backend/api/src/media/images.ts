import sharp from 'sharp';

/**
 * Turning an upload into an avatar.
 *
 * Every image is decoded and re-encoded, never stored as sent. That is what
 * strips metadata -- EXIF, including GPS location from a phone camera --
 * because sharp writes none unless asked to. It also means a file that only
 * claims to be an image is rejected, since it will not decode.
 */

/** Side of the stored square, in pixels: sharp at twice the largest size shown. */
export const AVATAR_SIZE = 512;

/** Upload ceiling, before decoding. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Pixel ceiling for decoding. A small file can claim enormous dimensions (a
 * decompression bomb); sharp refuses past this instead of allocating it.
 * 25 MP covers any phone camera at full resolution.
 */
const MAX_INPUT_PIXELS = 25_000_000;

/**
 * At most this many images decode at once, across the whole process. A
 * decode can hold ~100 MB and a core for a while, so without a ceiling a
 * handful of accounts uploading together could starve every other request.
 */
const MAX_CONCURRENT_DECODES = 2;

// The decoded-image cache only helps when the same input is processed
// repeatedly, which never happens here; it would just hold memory.
sharp.cache(false);

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;

export class UnreadableImageError extends Error {}

/**
 * The format the bytes actually are, by their signature, or null.
 *
 * Checked before anything is decoded, so only these four parsers ever see
 * an upload: a file declared as a PNG that is really an SVG, a TIFF or
 * anything else never reaches a decoder at all.
 */
export function sniff(bytes: Uint8Array): (typeof ACCEPTED_TYPES)[number] | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'image/avif';
  return null;
}

let active = 0;
const waiting: (() => void)[] = [];

async function withDecodeSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_DECODES) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  try {
    return await work();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export async function toAvatar(input: Uint8Array, declaredType = ''): Promise<Uint8Array> {
  const actual = sniff(input);
  if (!actual) throw new UnreadableImageError('Use a JPEG, PNG, WebP or AVIF image');

  // A mismatch is not an attack by itself (browsers mislabel), but it is a
  // file that is not what it says, so it is refused rather than guessed at.
  const declared = declaredType.split(';')[0]!.trim().toLowerCase();
  if (declared && declared !== actual) {
    throw new UnreadableImageError(`That file is a ${actual.slice(6)}, not a ${declared.slice(6)}`);
  }

  return withDecodeSlot(async () => {
    try {
      const output = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
        // Apply the camera's orientation flag to the pixels, then drop it
        // with the rest of the metadata, so a phone photo is not sideways.
        .rotate()
        // `entropy` keeps the busiest part of the frame (usually a face) at
        // a fraction of the cost of the saliency-based `attention`.
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'entropy' })
        .webp({ quality: 82 })
        .toBuffer();
      return new Uint8Array(output);
    } catch {
      throw new UnreadableImageError('That image could not be read');
    }
  });
}
