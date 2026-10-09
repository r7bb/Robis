/**
 * The name, set edge to edge.
 *
 * SVG text with `textLength` rather than a font size guessed per
 * breakpoint: the browser spaces the five letters to fill the width exactly,
 * at every viewport, and the `viewBox` scales the height with it. CSS has no
 * way to fit a line of type to its container without measuring it in
 * JavaScript, which would flash at the wrong size first.
 *
 * Decorative to assistive technology: the page's real heading is the
 * proposition underneath, and "Robis" is already in the header logo.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1000 172"
      aria-hidden="true"
      focusable="false"
      className={`block h-auto w-full select-none text-content ${className}`}
    >
      <text
        x="0"
        y="166"
        textLength="1000"
        lengthAdjust="spacing"
        fill="currentColor"
        style={{ fontSize: 228, fontWeight: 800, letterSpacing: '-0.02em' }}
      >
        ROBIS
      </text>
    </svg>
  );
}
