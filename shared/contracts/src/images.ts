/**
 * What an image file really is, by its first bytes.
 *
 * Shared by the API, which refuses a file that is not what it claims to be,
 * and the browser, which checks before uploading so a mislabelled file (a
 * WebP saved as .jpg) is sent under its real type instead of being refused.
 */

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export function sniffImage(bytes: Uint8Array): ImageType | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'image/avif';
  return null;
}
