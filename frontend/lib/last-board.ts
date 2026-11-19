/**
 * The board last open in each workspace, on this device, so coming back to
 * a workspace opens where you were. Only an id; a project since deleted is
 * passed over for the first one there is.
 */

const key = (workspaceId: string) => `robis.last-board.${workspaceId}`;

export function rememberBoard(workspaceId: string, projectId: string): void {
  try {
    localStorage.setItem(key(workspaceId), projectId);
  } catch {
    // Private mode: the first board opens instead.
  }
}

export function lastBoard(workspaceId: string): string | null {
  try {
    return localStorage.getItem(key(workspaceId));
  } catch {
    return null;
  }
}

/** The board to open: the remembered one while it exists, else the first. */
export function boardToOpen(
  projects: readonly { id: string; archived: boolean }[],
  remembered: string | null,
): string | null {
  const open = projects.filter((project) => !project.archived);
  return open.find((project) => project.id === remembered)?.id ?? open[0]?.id ?? null;
}
