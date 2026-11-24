import { z } from 'zod';
import { uuid } from '../schemas.ts';
import { contract } from './contract.ts';

/**
 * Importing issues into a board (C6): from a CSV file or a Robis workspace
 * export, each sent as the file itself, or from a GitHub repository.
 * Statuses and labels are mapped; an issue the project has imported before
 * is skipped, so running the same import twice creates nothing new.
 */

/** The largest CSV file taken. */
export const IMPORT_CSV_MAX_BYTES = 1024 * 1024;
/** The largest export zip taken for import. */
export const IMPORT_ZIP_MAX_BYTES = 20 * 1024 * 1024;
/** How many rows that could not be read are listed back. */
export const IMPORT_PROBLEMS_SHOWN = 50;

const projectParams = z.object({ workspaceId: uuid, projectId: uuid });

const importResult = z.object({
  found: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  labelsCreated: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  /** Rows or lines that could not be read, with why; at most IMPORT_PROBLEMS_SHOWN. */
  problems: z.array(z.object({ row: z.number().int(), reason: z.string() })),
});

export const importContracts = {
  'imports.csv': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/projects/:projectId/import/csv',
    summary:
      'Import issues from a CSV file whose first row names its columns (title, description, status, priority, labels, id).',
    params: projectParams,
    rawBody: 'text/csv',
    response: importResult,
  }),
  'imports.github': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/projects/:projectId/import/github',
    summary:
      "Import a GitHub repository's issues (not its pull requests), with labels and comments. The token, for a private repository or a higher rate limit, is used for this import alone and never kept.",
    params: projectParams,
    body: z.object({
      repo: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/, 'As owner/name')
        // Never "." or "..", which a URL would read as a step up GitHub's paths.
        .refine((repo) => !/\/\.{1,2}$/.test(repo), 'As owner/name'),
      token: z.string().trim().min(1).max(255).optional(),
    }),
    response: importResult,
  }),
  'imports.robis': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/projects/:projectId/import/robis',
    summary:
      'Import the issues of a Robis workspace export, with their labels and comments, into this board.',
    params: projectParams,
    rawBody: 'application/zip',
    response: importResult,
  }),
};
