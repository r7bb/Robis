/** A question whose answer is marked. */
export function SolvedChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-400/30">
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3" fill="none">
        <path
          d="m3.5 8.5 3 3 6-7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Solved
    </span>
  );
}
