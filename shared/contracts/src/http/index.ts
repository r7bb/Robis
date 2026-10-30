import { z } from 'zod';
import type { Contract } from './contract.ts';
import { workspaceContracts } from './workspaces.ts';

export * from './contract.ts';

/** Every route the API serves through a contract, by name. */
export const contracts = {
  ...workspaceContracts,
} as const satisfies Record<string, Contract>;

export type ContractName = keyof typeof contracts;

/** `/workspaces/:workspaceId` as OpenAPI spells it: `/workspaces/{workspaceId}`. */
function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function jsonSchema(schema: z.ZodType, io: 'input' | 'output') {
  return z.toJSONSchema(schema, {
    io,
    // A Date is the one type JSON cannot carry; it travels as an ISO string.
    unrepresentable: 'any',
    override: (ctx) => {
      if (ctx.zodSchema._zod.def.type === 'date') {
        ctx.jsonSchema.type = 'string';
        ctx.jsonSchema.format = 'date-time';
      }
    },
  });
}

function parameters(schema: z.ZodType | undefined, where: 'path' | 'query') {
  if (!schema) return [];
  const { properties = {}, required = [] } = jsonSchema(schema, 'input') as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: where,
    required: where === 'path' || required.includes(name),
    schema: property,
  }));
}

/**
 * The OpenAPI 3.1 document for every contract, generated: never edited by
 * hand. `bun run openapi` writes it to docs/openapi.json, and a test fails
 * when that file is not what this returns.
 */
export function openApiDocument(table: Record<string, Contract> = contracts) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [name, route] of Object.entries(table)) {
    const status = String(route.status ?? (route.response ? 200 : 204));
    const operation = {
      operationId: name,
      summary: route.summary,
      parameters: [...parameters(route.params, 'path'), ...parameters(route.query, 'query')],
      ...(route.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: jsonSchema(route.body, 'input') } },
            },
          }
        : {}),
      responses: {
        [status]: route.response
          ? {
              description: 'OK',
              content: { 'application/json': { schema: jsonSchema(route.response, 'output') } },
            }
          : { description: 'No content' },
      },
    };
    const key = openApiPath(route.path);
    paths[key] = { ...paths[key], [route.method.toLowerCase()]: operation };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Robis API',
      version: '0',
      description:
        'Generated from the route contracts in shared/contracts/src/http. A refused request answers { error, message }.',
    },
    paths,
  };
}
