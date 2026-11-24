import type { ProjectUpdateHealth } from '@robis/shared';

/** The team's own judgement of a board, as a word. */
export const UPDATE_HEALTH_NAMES: Record<ProjectUpdateHealth, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

const TONES: Record<ProjectUpdateHealth, string> = {
  on_track: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  at_risk: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  off_track: 'border-rose-400/40 bg-rose-400/10 text-rose-300',
};

/** On track, at risk or off track, said in words and tone. */
export function UpdateHealth({ health }: { health: ProjectUpdateHealth }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${TONES[health]}`}
    >
      {UPDATE_HEALTH_NAMES[health]}
    </span>
  );
}
