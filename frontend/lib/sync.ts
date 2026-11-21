'use client';

import { contracts, QUEUED_FOR_HEADER } from '@robis/shared';
import { createStorage, SyncEngine, SyncError, type SyncTransport } from '@robis/sync';
import { ApiError, api, BASE_URL, call } from './api.ts';

/**
 * Wires the transport-agnostic sync engine to this app's HTTP client and to
 * IndexedDB. The engine itself knows nothing about fetch or the browser, which
 * is what lets it be unit-tested without either.
 */

function toSyncError(error: unknown): SyncError {
  // Distinguishing "server refused" from "network unreachable" is what decides
  // whether a queued mutation is retried or discarded.
  if (error instanceof ApiError) return new SyncError(error.message, error.status, error.code);
  return new SyncError(error instanceof Error ? error.message : 'Network unavailable');
}

/**
 * How long the change waited in the queue, for the server's sync lag (Phase
 * 6): whole milliseconds on this device's clock, or nothing when unknown.
 */
function waitedHeader(queuedForMs: number | undefined): Record<string, string> {
  return queuedForMs === undefined ? {} : { [QUEUED_FOR_HEADER]: String(Math.round(queuedForMs)) };
}

/**
 * A raw image body, posted with its Idempotency-Key: image bytes are not
 * JSON, so this goes around `call`. A network failure is transient and the
 * queue keeps the bytes; a refusal carries the server's own message.
 */
async function postImage<T>(
  path: string,
  body: Blob,
  contentType: string,
  idempotencyKey: string,
  queuedForMs?: number,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': contentType,
        'idempotency-key': idempotencyKey,
        ...waitedHeader(queuedForMs),
      },
      body,
    });
  } catch (error) {
    throw toSyncError(error);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new SyncError(
      payload?.message ?? `Upload failed with ${response.status}`,
      response.status,
    );
  }
  return payload as T;
}

const transport: SyncTransport = {
  async createIssue(workspaceId, projectId, body, idempotencyKey, queuedForMs) {
    try {
      return await call(contracts['issues.create'], {
        params: { workspaceId, projectId },
        body,
        headers: { 'idempotency-key': idempotencyKey, ...waitedHeader(queuedForMs) },
      });
    } catch (error) {
      throw toSyncError(error);
    }
  },

  async updateIssue(workspaceId, issueId, body, idempotencyKey, queuedForMs) {
    try {
      return await call(contracts['issues.update'], {
        params: { workspaceId, issueId },
        body,
        headers: { 'idempotency-key': idempotencyKey, ...waitedHeader(queuedForMs) },
      });
    } catch (error) {
      throw toSyncError(error);
    }
  },

  async deleteIssue(workspaceId, issueId, queuedForMs) {
    try {
      await api<void>(`/workspaces/${workspaceId}/issues/${issueId}`, {
        method: 'DELETE',
        headers: waitedHeader(queuedForMs),
      });
    } catch (error) {
      throw toSyncError(error);
    }
  },

  /**
   * A raw image body rather than JSON, so this bypasses `api()`. The queued
   * mutation's id is the Idempotency-Key, which is what makes a replay after
   * a lost response return the first upload instead of storing a second.
   */
  uploadAttachment(workspaceId, issueId, body, contentType, idempotencyKey, queuedForMs) {
    return postImage<{ attachment: { id: string } }>(
      `/workspaces/${workspaceId}/issues/${issueId}/attachments`,
      body,
      contentType,
      idempotencyKey,
      queuedForMs,
    );
  },

  uploadStory(workspaceId, body, contentType, idempotencyKey, queuedForMs) {
    return postImage<{ story: { id: string } }>(
      `/workspaces/${workspaceId}/stories/photo`,
      body,
      contentType,
      idempotencyKey,
      queuedForMs,
    );
  },

  async listIssues(workspaceId, projectId) {
    try {
      return await call(contracts['issues.list'], {
        params: { workspaceId, projectId },
        query: { limit: 100 },
      });
    } catch (error) {
      throw toSyncError(error);
    }
  },
};

let engine: SyncEngine | null = null;

/** One engine per tab. Created lazily so it is never constructed during SSR,
 * where there is no IndexedDB. */
export function getSyncEngine(): SyncEngine {
  engine ??= new SyncEngine(createStorage('robis'), transport);
  return engine;
}
