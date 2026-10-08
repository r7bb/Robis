/**
 * The Robis mark.
 *
 * Two rounded squares, offset diagonally, overlapping. That is the product:
 * a copy on your device and a copy on the server, converging on the same
 * state. The overlap is drawn as its own shape rather than left to
 * transparency, because a `mix-blend-mode` overlap turns muddy against a
 * coloured background and disappears entirely in a favicon.
 *
 * Geometry only, and deliberately so. A hand-drawn illustrative logo is the
 * thing an engineer should not attempt; two squares and a radius is a shape
 * that holds at 16px and does not pretend to be more than it is.
 */

export function LogoMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      // Decorative: every use sits beside the wordmark or a visually hidden
      // name, so announcing it again would read the brand twice.
      aria-hidden="true"
      focusable="false"
    >
      {/* The remote copy, behind. Raised from 0.4: against a near-black
          page the fainter version read as a smudge rather than a second
          square, and the whole point of the mark is that there are two. */}
      <rect x="2" y="2" width="20" height="20" rx="6" fill="currentColor" opacity="0.55" />

      {/* The local copy, in front. */}
      <rect x="10" y="10" width="20" height="20" rx="6" fill="currentColor" />

      {/* Where they agree. A square join rather than a rounded one, so the
          overlap stays legible instead of merging into one blob. */}
      <path d="M10 10h12v12H10z" fill="currentColor" opacity="0.75" />
    </svg>
  );
}

/** Mark plus wordmark, for the nav and the footer. */
export function Logo({
  size = 32,
  className = '',
  markClassName = 'text-accent',
  /** The wordmark scales with the mark rather than being set separately. */
  wordClassName = 'text-xl',
}: {
  size?: number;
  className?: string;
  markClassName?: string;
  wordClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} className={markClassName} />
      <span className={`font-semibold tracking-tight ${wordClassName}`}>Robis</span>
    </span>
  );
}
