/**
 * Prerender the landing's screenshots to WebP (stage 2, item 19), before
 * `next dev` and `next build`.
 *
 * The app serves images as they are (`images.unoptimized`), so Next never
 * loads an image library at run time and the web image carries none. The
 * sizing Next did per request happens once here instead: each PNG in
 * `public/shots` (the capture script writes them at twice 1440 by 900) is
 * scaled to the widest the page shows it, at twice that for sharp screens.
 * The WebP files are build output, not committed.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/** The landing shows a shot at most 1100 CSS pixels wide (`Shot`'s `sizes`). */
const WIDTH = 2200;
const QUALITY = 80;

// Node's spelling rather than Bun's: Next type-checks this with the app.
const SHOTS = fileURLToPath(new URL('../public/shots/', import.meta.url));

const sources = (await readdir(SHOTS)).filter((name) => name.endsWith('.png'));
for (const name of sources) {
  await sharp(join(SHOTS, name))
    .resize({ width: WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toFile(join(SHOTS, name.replace(/\.png$/, '.webp')));
}
console.log(`Prerendered ${sources.length} landing image(s) to WebP.`);
