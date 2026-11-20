import sharp from 'sharp';

/**
 * A meme (Phase 2c): a free-to-change picture (public domain or CC0) with
 * a caption from the list below drawn across its foot. Written for a team:
 * about the work, never about a person. Drawn here, by Robis, with sharp.
 */

export const MEME_CAPTIONS: readonly string[] = [
  'When the standup ends five minutes early',
  'Me, checking the board after the weekend',
  'The build after one more small change',
  'Friday deploys, seen from a safe distance',
  'When the bug fixes itself on the second try',
  'Inbox zero, as it really looks',
  'Waiting for the review like',
  'The team when the demo just works',
  'My calendar, between meetings',
  'Shipping it, at last',
];

const WIDTH = 1600;

/** XML-safe, so a caption can never become markup in the SVG. */
function escaped(text: string): string {
  return text.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The picture at a feed's width, with the caption in a band across its foot. */
export async function memeOf(bytes: Uint8Array, caption: string): Promise<Uint8Array> {
  const base = sharp(bytes, { limitInputPixels: 25_000_000 }).rotate().resize(WIDTH, WIDTH, {
    fit: 'inside',
    withoutEnlargement: false,
  });
  const { data, info } = await base.jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
  const size = Math.round(info.width / 20);
  const band = Math.round(size * 2.4);
  const svg = `<svg width="${info.width}" height="${info.height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.72"/></linearGradient></defs>
    <rect x="0" y="${info.height - band * 1.6}" width="${info.width}" height="${band * 1.6}" fill="url(#fade)"/>
    <text x="50%" y="${info.height - band * 0.55}" text-anchor="middle"
      font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="${size}"
      fill="#fff" stroke="#000" stroke-width="${Math.max(2, size / 14)}" paint-order="stroke">${escaped(caption)}</text>
  </svg>`;
  const out = await sharp(data)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
  return new Uint8Array(out);
}
