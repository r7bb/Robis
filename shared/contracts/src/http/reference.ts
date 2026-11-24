import { z } from 'zod';
import { type Contract, statusesOf } from './contract.ts';

/**
 * The API reference as Markdown (C7), written from the same contracts as
 * docs/openapi.json, so the page people read and the document tools read
 * cannot disagree. `bun run openapi` writes both; a test fails when either
 * is stale.
 */

const INTRO = `# Robis API reference

Every route the API serves through a contract, grouped by what it is for.
Generated from the Zod contracts that the server validates against, by
\`bun run openapi\`; the same contracts make [openapi.json](openapi.json),
which a running server also serves at \`/api/openapi.json\`. Do not edit
this file by hand.

**Address.** Every path is under \`/api\` on the site's own address.

**Signing in.** A browser sends its session cookie. A script sends a
personal access token, made on the account page, as
\`Authorization: Bearer rbp_…\`: it acts as its owner on routes under
\`/workspaces/{workspaceId}\` only, and without the write scope it may only
read (any other method answers 403). Agents send their own tokens the same
way.

**Answers.** JSON, with the status shown. A refusal is
\`{ "error": "<code>", "message": "<words for people>" }\`. A stranger to a
workspace gets 404, never 403, so its existence is not given away.
`;

/** Where a route belongs: the part after the workspace, or its first segment. */
function groupOf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  const start = parts[0] === 'workspaces' && parts[1] === ':workspaceId' ? 2 : 0;
  const part = parts[start] ?? parts[0] ?? 'root';
  return part.startsWith(':') ? (parts[0] ?? 'root') : part;
}

function fieldsOf(schema: unknown): string | null {
  if (!(schema instanceof z.ZodObject)) return null;
  const fields = Object.entries(schema.shape as Record<string, z.ZodType>).map(([name, field]) =>
    field.safeParse(undefined).success ? `\`${name}\`` : `\`${name}\` (required)`,
  );
  return fields.length ? fields.join(', ') : null;
}

function entry(name: string, route: Contract): string {
  const path = route.path.replace(/:(\w+)/g, '{$1}');
  const lines = [`### \`${route.method} ${path}\``, '', route.summary, ''];
  const body = route.rawBody
    ? `the file itself, as \`${route.rawBody}\``
    : route.body
      ? fieldsOf(route.body)
      : null;
  if (body) lines.push(`- Body: ${body}`);
  const query = route.query ? fieldsOf(route.query) : null;
  if (query) lines.push(`- Query: ${query}`);
  lines.push(`- Answers: ${statusesOf(route).join(', ')}`, `- Name: \`${name}\``, '');
  return lines.join('\n');
}

export function apiReference(table: Record<string, Contract>): string {
  const groups = new Map<string, [string, Contract][]>();
  for (const [name, route] of Object.entries(table)) {
    const group = groupOf(route.path);
    groups.set(group, [...(groups.get(group) ?? []), [name, route]]);
  }
  const sections = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, routes]) => {
      const sorted = [...routes].sort(
        ([, a], [, b]) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
      );
      return [`## ${group}`, '', ...sorted.map(([name, route]) => entry(name, route))].join('\n');
    });
  const count = Object.keys(table).length;
  return `${INTRO}\n${count} routes.\n\n${sections.join('\n')}`.replace(/\n{3,}/g, '\n\n');
}
