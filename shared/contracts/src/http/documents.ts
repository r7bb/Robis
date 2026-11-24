import { z } from 'zod';
import { createDocumentSchema, updateDocumentSchema, uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/** The id stays a plain string: one that is not a document is a 404, not a 400. */
const documentParams = workspaceParams.extend({ documentId: z.string() });

/**
 * A document as the API lists it. Never its stored editing state or its
 * search copy: the content travels over the live gateway, and as text on
 * `documents.get`.
 */
const document = z.object({
  id: uuid,
  title: z.string(),
  projectId: uuid.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const documentContracts = {
  'documents.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/documents',
    summary: "A workspace's documents, most recently changed first.",
    params: workspaceParams,
    response: z.object({ documents: z.array(document) }),
  }),
  'documents.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/documents',
    summary: 'Start a document, in the workspace or under one of its projects.',
    params: workspaceParams,
    body: createDocumentSchema,
    status: 201,
    response: z.object({ document }),
  }),
  'documents.get': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/documents/:documentId',
    summary: 'One document, with its text as it stands.',
    params: documentParams,
    response: z.object({ document: document.extend({ text: z.string() }) }),
  }),
  'documents.update': contract({
    method: 'PATCH',
    path: '/workspaces/:workspaceId/documents/:documentId',
    summary: 'Rename a document.',
    params: documentParams,
    body: updateDocumentSchema,
    response: z.object({ document }),
  }),
  'documents.delete': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/documents/:documentId',
    summary: 'Delete a document and its history.',
    params: documentParams,
    status: 204,
    response: null,
  }),
  'documents.versions': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/documents/:documentId/versions',
    summary:
      'How a document read at moments while it changed, newest first: at most one every ten minutes, the latest fifty.',
    params: documentParams,
    response: z.object({
      versions: z.array(
        z.object({
          id: uuid,
          createdAt: timestamp,
          /** The start of it, for the list. */
          preview: z.string(),
          length: z.number().int().nonnegative(),
        }),
      ),
    }),
  }),
  'documents.keepVersion': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/documents/:documentId/versions',
    summary:
      'Keep the document as it reads now as a version, before putting another back, so that can be undone too.',
    params: documentParams,
    response: z.object({ kept: z.boolean() }),
  }),
  'documents.version': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/documents/:documentId/versions/:versionId',
    summary: 'One version of a document, whole, to read or put back.',
    params: documentParams.extend({ versionId: z.string() }),
    response: z.object({ version: z.object({ id: uuid, createdAt: timestamp, text: z.string() }) }),
  }),
} as const;
