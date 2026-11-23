/**
 * The workspace export job (C6). Run by the API's own runner rather than the
 * worker: it reads nearly every table the workspace owns, and the worker's
 * role is kept to the few it needs.
 */
export const WORKSPACE_EXPORT_JOB = 'workspace.export';
export type WorkspaceExportPayload = { exportId: string };
