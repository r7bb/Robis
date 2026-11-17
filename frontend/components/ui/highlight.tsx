/**
 * A search excerpt (C1): plain text pieces with the matched ones marked.
 * Every piece is rendered as text, so nothing in an issue or a comment can
 * become markup on its way to the screen.
 */
export function Highlight({
  parts,
  className = '',
}: {
  parts: readonly { text: string; match: boolean }[];
  className?: string;
}) {
  return (
    <p className={className}>
      {parts.map((part, index) =>
        part.match ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: pieces are positional and re-rendered wholesale; the index is their only identity.
          <mark key={index} className="rounded bg-accent/20 px-0.5 text-accent-soft">
            {part.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above.
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}
