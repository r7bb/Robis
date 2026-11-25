import {
  type CreateProjectInput,
  PROJECT_TEMPLATES,
  type ProjectTemplate,
  TEMPLATE_DETAILS,
} from '@robis/shared';

/** How a new board begins: empty, or with one of the built-in templates' starter issues. */
export type BoardStart = ProjectTemplate | 'blank';

/** Empty first, then each template, as the choices are offered. */
export const BOARD_STARTS: readonly BoardStart[] = ['blank', ...PROJECT_TEMPLATES];

/** The short name of a starting choice. */
export const boardStartLabel = (start: BoardStart) =>
  start === 'blank' ? 'Empty' : TEMPLATE_DETAILS[start].label;

/** The body that makes a board: its name, and its template unless it begins empty. */
export function newBoardBody(name: string, start: BoardStart): CreateProjectInput {
  const trimmed = name.trim();
  return start === 'blank' ? { name: trimmed } : { name: trimmed, template: start };
}
