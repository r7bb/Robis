import {
  attachments,
  automationRules,
  channels,
  comments,
  type Database,
  documents,
  type Executor,
  issueLabels,
  issues,
  labels,
  loadDocument,
  meetings,
  messages,
  projects,
  savedViews,
  users,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import { type MediaStorage, writeZip, type ZipEntry } from '@robis/storage';
import { eq, sql } from 'drizzle-orm';

/**
 * What a workspace export holds (C6), as JSON lines, one file per kind,
 * plus every attached image and chat picture under `files/`.
 *
 * Left out on purpose: search indexes and storage keys (internal, and
 * rebuilt on import), webhook secrets (a secret leaves only by being shown
 * once to an admin), and members' email addresses (the export names people
 * by name and username; an address is personal data the importer does not
 * need). Stories expire within a day and the audit trail has its own
 * export, so neither is here.
 */

const EXPORT_FORMAT = 'robis-export';
const EXPORT_VERSION = 1;
/**
 * An export larger than this fails with a message rather than filling
 * memory: it is built in memory, in the API process, so this bounds what
 * one build can hold (about twice this at its peak, while the zip is
 * assembled). Runs one at a time per API instance, on a runner of its own.
 */
const MAX_EXPORT_BYTES = 256 * 1024 * 1024;

export class ExportTooLarge extends Error {}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const extensionOf = (contentType: string) => EXTENSIONS[contentType] ?? 'bin';

const encoder = new TextEncoder();
const jsonl = (rows: readonly object[]) =>
  encoder.encode(rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));

function without<T extends object, K extends keyof T>(row: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...row };
  for (const key of keys) delete copy[key];
  return copy;
}

/** The rows, by file name, with the files they point at. */
async function collect(db: Executor, workspaceId: string) {
  const [workspace] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      theme: workspaces.theme,
      createdAt: workspaces.createdAt,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!workspace) throw new Error('workspace not found');

  const members = await db
    .select({
      userId: workspaceMembers.userId,
      username: users.username,
      name: users.name,
      kind: users.kind,
      role: workspaceMembers.role,
      title: workspaceMembers.title,
      joinedAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId));

  const docRows = await db.select().from(documents).where(eq(documents.workspaceId, workspaceId));
  const docs = [];
  for (const doc of docRows) {
    const text = (await loadDocument(db, doc.id)).getText('content').toString();
    docs.push({ ...without(doc, 'snapshot', 'searchText', 'searchVector'), text });
  }

  const attachmentRows = await db
    .select()
    .from(attachments)
    .where(eq(attachments.workspaceId, workspaceId));
  const messageRows = await db.select().from(messages).where(eq(messages.workspaceId, workspaceId));
  const ruleRows = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.workspaceId, workspaceId));

  const files = [
    ...attachmentRows.map((a) => ({
      key: a.storageKey,
      path: `files/attachments/${a.id}.${extensionOf(a.contentType)}`,
    })),
    ...messageRows
      .filter((m) => m.imageKey && m.imageContentType)
      .map((m) => ({
        key: m.imageKey!,
        path: `files/messages/${m.id}.${extensionOf(m.imageContentType!)}`,
      })),
  ];
  const fileOf = new Map(files.map((f) => [f.key, f.path]));

  const rows: Record<string, readonly object[]> = {
    'members.jsonl': members,
    'projects.jsonl': await db.select().from(projects).where(eq(projects.workspaceId, workspaceId)),
    'labels.jsonl': await db.select().from(labels).where(eq(labels.workspaceId, workspaceId)),
    'issues.jsonl': (await db.select().from(issues).where(eq(issues.workspaceId, workspaceId))).map(
      (i) => without(i, 'searchVector'),
    ),
    'issue-labels.jsonl': await db
      .select()
      .from(issueLabels)
      .where(eq(issueLabels.workspaceId, workspaceId)),
    'comments.jsonl': (
      await db.select().from(comments).where(eq(comments.workspaceId, workspaceId))
    ).map((c) => without(c, 'searchVector')),
    'documents.jsonl': docs,
    'channels.jsonl': await db.select().from(channels).where(eq(channels.workspaceId, workspaceId)),
    'messages.jsonl': messageRows.map((m) => ({
      ...without(m, 'searchVector', 'imageKey'),
      file: m.imageKey ? (fileOf.get(m.imageKey) ?? null) : null,
    })),
    'meetings.jsonl': await db.select().from(meetings).where(eq(meetings.workspaceId, workspaceId)),
    'attachments.jsonl': attachmentRows.map((a) => ({
      ...without(a, 'storageKey'),
      file: fileOf.get(a.storageKey) ?? null,
    })),
    'automation-rules.jsonl': ruleRows.map((r) => ({
      ...r,
      action: safeAction(r.action as { secret?: string; url?: string }),
    })),
    'saved-views.jsonl': await db
      .select()
      .from(savedViews)
      .where(eq(savedViews.workspaceId, workspaceId)),
  };
  return { workspace, rows, files };
}

/**
 * A rule's action without its credentials: never the signing secret, and
 * of a webhook's address only its origin, since for many services the full
 * address is itself the key.
 */
function safeAction(action: { secret?: string; url?: string }) {
  const { secret: _secret, ...rest } = action;
  if (typeof rest.url !== 'string') return rest;
  try {
    return { ...rest, url: `${new URL(rest.url).origin}/…` };
  } catch {
    return { ...rest, url: null };
  }
}

/**
 * What the files will weigh, read before anything is loaded, so an export
 * far too large fails at once instead of after filling memory.
 */
async function fileBytes(db: Executor, workspaceId: string): Promise<number> {
  const [row] = await db.execute<{ total: string | null }>(sql`
    select coalesce((select sum(bytes) from attachments where workspace_id = ${workspaceId}), 0)
         + coalesce((select sum(image_bytes) from messages where workspace_id = ${workspaceId}), 0)
           as total`);
  return Number(row?.total ?? 0);
}

const README = `A Robis workspace export.

manifest.json says what is here and how many of each. Every other .jsonl
file holds one JSON object per line, one file per kind: projects, issues,
comments, documents (with their text), channels, messages, meetings and
the rest. Ids connect them: an issue's projectId is a project's id.
Attached images and chat pictures are under files/, named by the id of
the row that points at them.

Members are named by name and username; email addresses are not included.
Webhook rules keep only the origin of their address, and never their secret.
Meeting join links are included as members see them in the app.
`;

/** The export of one workspace, as zip bytes, and how many rows of each kind. */
export async function buildExport(db: Database, storage: MediaStorage, workspaceId: string) {
  const tooLarge = () =>
    new ExportTooLarge(
      `The export passed ${MAX_EXPORT_BYTES / 1024 / 1024} MB, the most one can hold.`,
    );
  if ((await fileBytes(db, workspaceId)) > MAX_EXPORT_BYTES) throw tooLarge();
  // Every table read from one snapshot, so a comment never points at an
  // issue made after the issues were read.
  const { workspace, rows, files } = await db.transaction((tx) => collect(tx, workspaceId), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
  const entries: ZipEntry[] = [];
  let total = 0;
  const add = (name: string, data: Uint8Array) => {
    total += data.byteLength;
    if (total > MAX_EXPORT_BYTES) throw tooLarge();
    entries.push({ name, data });
  };

  for (const [name, list] of Object.entries(rows)) add(name, jsonl(list));
  const missing: string[] = [];
  for (const file of files) {
    const object = await storage.open(file.key);
    if (!object) {
      missing.push(file.path);
      continue;
    }
    add(file.path, new Uint8Array(await new Response(object.stream).arrayBuffer()));
  }

  const counts = Object.fromEntries(
    Object.entries(rows).map(([name, list]) => [name, list.length]),
  );
  const manifest = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    workspace,
    exportedAt: new Date().toISOString(),
    counts,
    files: files.length - missing.length,
    missingFiles: missing,
  };
  entries.unshift(
    { name: 'manifest.json', data: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`) },
    { name: 'README.txt', data: encoder.encode(README) },
  );
  return { bytes: writeZip(entries), counts };
}
