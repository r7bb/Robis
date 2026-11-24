import type { Database } from '@robis/database';
import {
  contracts,
  IMPORT_CSV_MAX_BYTES,
  IMPORT_PROBLEMS_SHOWN,
  IMPORT_ZIP_MAX_BYTES,
} from '@robis/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { applyImport } from '../imports/apply.ts';
import { csvIssues } from '../imports/csv.ts';
import type { ImportedIssue, ImportProblem } from '../imports/model.ts';
import { NotAnExport, robisIssues } from '../imports/robis.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { loadProject } from './projects.ts';

/**
 * Import issues into a board (C6), from a CSV file or a Robis export, each
 * sent as the file itself. Anyone who may make issues and labels may import; the
 * import is one transaction and one entry in the trail.
 */

const IMPORTS_PER_MINUTE = 6;

/** Turned away before the body is read: no credentials, or a file over the limit. */
const admit = (limit: number) => async (request: FastifyRequest) => {
  if (Number(request.headers['content-length'] ?? 0) > limit) {
    throw new ApiError(
      413,
      'payload_too_large',
      `That file is larger than ${limit / 1024 / 1024} MB`,
    );
  }
  if (!request.headers.cookie && !request.headers.authorization) throw ApiError.unauthorized();
};

export async function importRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  app.addContentTypeParser(
    'text/csv',
    { parseAs: 'string', bodyLimit: IMPORT_CSV_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );
  app.addContentTypeParser(
    'application/zip',
    { parseAs: 'buffer', bodyLimit: IMPORT_ZIP_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );
  const guards = [
    requireAuth,
    // It may make labels as well as issues, so it asks what making a label asks.
    requireMembership(db, 'project:update'),
    rateLimit({ name: 'issues-import', limit: IMPORTS_PER_MINUTE, windowMs: 60_000 }),
  ];

  async function land(
    request: FastifyRequest,
    projectId: string,
    source: string,
    read: { issues: ImportedIssue[]; problems: ImportProblem[] },
  ) {
    const { workspaceId } = currentMembership(request);
    await loadProject(db, workspaceId, projectId);
    const result = await applyImport(db, auditActor(request), currentUser(request), {
      workspaceId,
      projectId,
      source,
      issues: read.issues,
    });
    return { ...result, problems: read.problems.slice(0, IMPORT_PROBLEMS_SHOWN) };
  }

  serve(
    app,
    contracts['imports.csv'],
    { onRequest: [admit(IMPORT_CSV_MAX_BYTES)], preHandler: guards },
    async (request, { params }) => {
      if (typeof request.body !== 'string' || request.body.length === 0) {
        throw ApiError.badRequest('Send the CSV file as text/csv', 'not_csv');
      }
      return land(request, params.projectId, 'csv', csvIssues(request.body));
    },
  );

  serve(
    app,
    contracts['imports.robis'],
    { onRequest: [admit(IMPORT_ZIP_MAX_BYTES)], preHandler: guards },
    async (request, { params }) => {
      if (!(request.body instanceof Buffer) || request.body.length === 0) {
        throw ApiError.badRequest('Send the export as application/zip', 'not_zip');
      }
      let read: ReturnType<typeof robisIssues>;
      try {
        read = robisIssues(new Uint8Array(request.body));
      } catch (error) {
        if (error instanceof NotAnExport) throw ApiError.badRequest(error.message, 'not_an_export');
        throw error;
      }
      return land(request, params.projectId, 'robis', read);
    },
  );
}
