/**
 * Initials in a tinted circle.
 *
 * Robis has no file uploads, so there are no uploaded photographs to show.
 * Rather than give everyone the same grey silhouette -- which makes a member
 * list unscannable -- each person gets a colour derived from their user id.
 * It is stable across sessions and devices because it is a pure function of
 * the id, with no state to keep in sync.
 */

/**
 * Hues are spaced around the wheel rather than taken from a palette, so no
 * two adjacent entries in a sorted list collide by construction. Saturation
 * and lightness are fixed at values that stay legible on both the dark and
 * light themes.
 */
const HUES = [210, 260, 320, 10, 35, 90, 150, 185];

function hueFor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    // Classic 32-bit string hash. Not cryptographic and does not need to be:
    // the only requirement is that it spreads similar ids apart.
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }

  return HUES[Math.abs(hash) % HUES.length]!;
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
} as const;

export type AvatarSize = keyof typeof SIZES;

export function Avatar({
  name,
  seed,
  size = 'md',
  className = '',
}: {
  name: string;
  /** Usually the user id. Falls back to the name when there is no id. */
  seed?: string;
  size?: AvatarSize;
  className?: string;
}) {
  const hue = hueFor(seed ?? name);

  return (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold ${SIZES[size]} ${className}`}
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
