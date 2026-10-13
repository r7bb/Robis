'use client';

import type { Avatar as AvatarRef } from '@robis/shared';
import { type CSSProperties, useState } from 'react';
import { BASE_URL } from '../../lib/api.ts';

/**
 * A person's picture: their photo, a generated orb, or their initials.
 *
 * Photos load from the API with the session cookie, which checks that the
 * viewer shares a workspace with the person; if that fails for any reason
 * the initials show instead of a broken image. A generated avatar is drawn
 * here from its seed, so it costs no request and reveals nothing. Initials
 * remain for anyone who has not chosen a picture yet.
 *
 * Colours come from a hash of the seed (usually the user id), so they are
 * stable across sessions and devices with no state to keep in sync.
 */

/**
 * Hues are spaced around the wheel rather than taken from a palette, so no
 * two adjacent entries in a sorted list collide by construction. Saturation
 * and lightness are fixed at values that stay legible on both the dark and
 * light themes.
 */
const HUES = [210, 260, 320, 10, 35, 90, 150, 185];

function hashOf(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    // Classic 32-bit string hash. Not cryptographic and does not need to be:
    // the only requirement is that it spreads similar ids apart.
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function hueFor(seed: string): number {
  return HUES[hashOf(seed) % HUES.length]!;
}

/**
 * The generated avatar: two soft light sources over a deep base, angled by
 * the seed. Deliberately abstract -- a face or a cartoon would say something
 * about the person that they did not choose.
 */
export function orbStyle(seed: string): CSSProperties {
  const hash = hashOf(seed);
  const first = HUES[hash % HUES.length]!;
  const second = HUES[(hash >> 3) % HUES.length]!;
  const angle = hash % 360;

  return {
    backgroundColor: `hsl(${first} 55% 22%)`,
    backgroundImage: [
      `radial-gradient(circle at 30% 25%, hsl(${first} 85% 68% / 0.95), transparent 55%)`,
      `radial-gradient(circle at 75% 80%, hsl(${second} 85% 60% / 0.9), transparent 60%)`,
      `conic-gradient(from ${angle}deg, hsl(${first} 60% 30%), hsl(${second} 60% 34%), hsl(${first} 60% 30%))`,
    ].join(', '),
  };
}

/** First letters of the first two words -- "Ada Lovelace" becomes "AL". */
export function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('');

  // A name made entirely of punctuation would otherwise render an empty
  // circle; "?" at least says "we could not read this".
  return letters.toUpperCase() || '?';
}

const SIZES = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-12 w-12 text-sm',
  xl: 'h-20 w-20 text-xl',
  '2xl': 'h-28 w-28 text-3xl',
} as const;

export type AvatarSize = keyof typeof SIZES;

export function Avatar({
  name,
  seed,
  avatar = null,
  size = 'md',
  className = '',
}: {
  name: string;
  /** Usually the user id. Falls back to the name when there is no id. */
  seed?: string;
  /** The chosen picture, when the caller has it. */
  avatar?: AvatarRef;
  size?: AvatarSize;
  className?: string;
}) {
  // Remembered per URL: a new picture (a new `?v=`) gets a fresh attempt
  // instead of inheriting an earlier failure.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const base = `inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold ${SIZES[size]} ${className}`;

  if (avatar?.kind === 'photo' && brokenUrl !== avatar.url) {
    return (
      // A plain img: the bytes come from the API with the session cookie,
      // which an image optimiser in between would not carry. The name is
      // always rendered beside it, so the picture itself is decorative.
      // biome-ignore lint/performance/noImgElement: see above
      <img
        src={`${BASE_URL}${avatar.url}`}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        onError={() => setBrokenUrl(avatar.url)}
        className={`${base} object-cover`}
      />
    );
  }

  if (avatar?.kind === 'generated') {
    return <span className={base} style={orbStyle(avatar.seed)} aria-hidden="true" />;
  }

  const hue = hueFor(seed ?? name);

  return (
    <span
      className={base}
      style={{
        backgroundColor: `hsl(${hue} 60% 30%)`,
        color: `hsl(${hue} 90% 88%)`,
      }}
      // The initials are decorative -- the name is always rendered beside
      // this -- so the circle is hidden rather than read out twice.
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}
