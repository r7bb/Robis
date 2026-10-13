/**
 * Make a picture uploadable before it leaves the device.
 *
 * Drawn onto a canvas and re-encoded as JPEG at a sensible size. That turns
 * formats the server does not take (a phone's HEIC, a pasted bitmap) into
 * one it does, keeps uploads small on a slow connection, and drops the
 * file's metadata on the way. The server re-encodes and strips again
 * regardless; this is for speed and compatibility, not trust.
 */

const MAX_SIDE = 1600;
const QUALITY = 0.9;

export async function preparePhoto(source: Blob): Promise<Blob> {
  // `from-image` applies the camera's orientation flag, so the canvas
  // receives the picture the right way up.
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare the picture');
    context.drawImage(bitmap, 0, 0, width, height);
  } finally {
    bitmap.close();
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The picture could not be prepared'))),
      'image/jpeg',
      QUALITY,
    );
  });
}
