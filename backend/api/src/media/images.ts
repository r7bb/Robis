import { sniffImage } from '@robis/shared';
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
export const MAX_CONCURRENT_DECODES = 2;

/**
 * How many may wait for a slot (stage 3, item 31). Past this, an upload is
 * told to come back (503, Retry-After) rather than queued without end, so a
 * flood holds no more memory than this many bodies.
 */
export const MAX_WAITING_DECODES = 8;

/** Seconds a refused upload is told to wait before trying again. */
export const DECODE_RETRY_AFTER_SECONDS = 2;

// The decoded-image cache only helps when the same input is processed
// repeatedly, which never happens here; it would just hold memory.
sharp.cache(false);

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;

export class UnreadableImageError extends Error {}

/** Every decode slot and every place in line is taken. */
export class ImagesBusyError extends Error {}

/**
 * The format the bytes actually are, by their signature, or null. Checked
 * before anything is decoded, so only these four parsers ever see an upload.
 */
export const sniff = sniffImage;

let active = 0;
const waiting: (() => void)[] = [];

/**
 * Run `work` holding one of the decode slots. A slot freed with someone in
 * line is handed straight to them, never counted free in between, so a
 * newcomer arriving at that moment cannot take it as well and pass the cap.
 */
export async function withDecodeSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active < MAX_CONCURRENT_DECODES) {
    active++;
  } else {
    if (waiting.length >= MAX_WAITING_DECODES) {
      throw new ImagesBusyError('Too many images are being processed. Try again shortly.');
    }
    // Woken holding the slot its releaser handed over: `active` is unchanged.
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
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

/** The longest side an attachment is kept at: enough to read a screenshot. */
const ATTACHMENT_MAX_SIDE = 2560;

export type ProcessedImage = {
  bytes: Uint8Array;
  contentType: 'image/png' | 'image/webp';
  extension: 'png' | 'webp';
  width: number;
  height: number;
};

/**
 * Turn an uploaded image into an attachment.
 *
 * Same checks and the same metadata stripping as an avatar, without the
 * square crop. A PNG stays a lossless PNG, because that is what screenshots
 * are and lossy compression smears their text; everything else becomes
 * WebP. Nothing is enlarged.
 */
export async function toAttachment(input: Uint8Array, declaredType = ''): Promise<ProcessedImage> {
  const actual = sniff(input);
  if (!actual) throw new UnreadableImageError('Use a JPEG, PNG, WebP or AVIF image');

  const declared = declaredType.split(';')[0]!.trim().toLowerCase();
  if (declared && declared !== actual) {
    throw new UnreadableImageError(`That file is a ${actual.slice(6)}, not a ${declared.slice(6)}`);
  }

  const lossless = actual === 'image/png';

  return withDecodeSlot(async () => {
    try {
      const pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize(ATTACHMENT_MAX_SIDE, ATTACHMENT_MAX_SIDE, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      const { data, info } = await (lossless
        ? pipeline.png({ compressionLevel: 9 })
        : pipeline.webp({ quality: 86 })
      ).toBuffer({ resolveWithObject: true });

      return {
        bytes: new Uint8Array(data),
        contentType: lossless ? 'image/png' : 'image/webp',
        extension: lossless ? 'png' : 'webp',
        width: info.width,
        height: info.height,
      };
    } catch {
      throw new UnreadableImageError('That image could not be read');
    }
  });
}
