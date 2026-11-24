/**
 * `bun run icons`: the installable app's icons (C8), drawn from the same
 * geometry as frontend/app/icon.svg so the home-screen icon and the
 * favicon cannot drift. The squares are the logo; the maskable icon keeps
 * them inside the middle 80% (the safe zone launchers crop to) on a
 * full-bleed background, since a launcher may cut it to any shape.
 */
import sharp from 'sharp';

const BACKGROUND = '#0e1014';
const ACCENT = '#6366f1';
const OUT = new URL('../../frontend/public/icons/', import.meta.url);

/** The logo's squares on a 32-unit grid, offset and scaled into `size`. */
function svg(size: number, { rounded, inset }: { rounded: boolean; inset: number }) {
  const scale = (size * (1 - 2 * inset)) / 32;
  const offset = size * inset;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="${BACKGROUND}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <rect x="4" y="4" width="17" height="17" rx="5" fill="${ACCENT}" opacity="0.4"/>
    <rect x="11" y="11" width="17" height="17" rx="5" fill="${ACCENT}"/>
    <path d="M11 11h10v10H11z" fill="${ACCENT}" opacity="0.75"/>
  </g>
</svg>`;
}

const ICONS = [
  { name: 'icon-192.png', size: 192, rounded: true, inset: 0 },
  { name: 'icon-512.png', size: 512, rounded: true, inset: 0 },
  { name: 'maskable-512.png', size: 512, rounded: false, inset: 0.1 },
  // iOS rounds the corners itself and shows no transparency.
  { name: 'apple-touch-icon.png', size: 180, rounded: false, inset: 0.06 },
];

for (const icon of ICONS) {
  const file = new URL(icon.name, OUT);
  await sharp(Buffer.from(svg(icon.size, icon)))
    .png()
    .toFile(file.pathname);
  console.log(`Wrote ${file.pathname}`);
}
