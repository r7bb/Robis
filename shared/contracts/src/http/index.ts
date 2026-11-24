import { z } from 'zod';
import { accountContracts } from './account.ts';
import { agentContracts } from './agents.ts';
import { attachmentContracts } from './attachments.ts';
import { auditContracts } from './audit.ts';
import { authContracts } from './auth.ts';
import { automationContracts } from './automation.ts';
import { calendarContracts } from './calendar.ts';
import { channelContracts } from './channels.ts';
import { type Contract, statusesOf } from './contract.ts';
import { discussionContracts } from './discussion.ts';
import { documentContracts } from './documents.ts';
import { exportContracts } from './exports.ts';
import { feedContracts } from './feed.ts';
import { feedHighlightContracts } from './feed-highlights.ts';
import { feedbackContracts } from './feedback.ts';
import { githubContracts } from './github.ts';
import { importContracts } from './imports.ts';
import { insightContracts } from './insights.ts';
import { issueContracts } from './issues.ts';
import { bulkIssueContracts } from './issues-bulk.ts';
import { labelContracts } from './labels.ts';
import { meetingContracts } from './meetings.ts';
import { memberContracts } from './members.ts';
import { notificationSettingContracts, unsubscribeContracts } from './notification-settings.ts';
import { notificationContracts } from './notifications.ts';
import { overviewContracts } from './overview.ts';
import { passkeyContracts } from './passkeys.ts';
import { personalTokenContracts } from './personal-tokens.ts';
import { profileContracts } from './profiles.ts';
import { projectContracts } from './projects.ts';
import { pushContracts } from './push.ts';
import { apiReference } from './reference.ts';
import { savedViewContracts } from './saved-views.ts';
import { storyContracts } from './stories.ts';
import { twoFactorContracts } from './two-factor.ts';
import { webhookContracts } from './webhooks.ts';
import { weekContracts } from './week.ts';
import { workspaceContracts } from './workspaces.ts';

export {
  AGENT_CHANGE_STATES,
  AGENT_CHANGES_SHOWN,
  RUN_STEPS_SHOWN,
  RUNS_SHOWN,
} from './agents.ts';
export { SEARCH_KINDS, SEARCH_LIMIT_MAX } from './audit.ts';
export {
  AUTOMATION_CONDITIONS_MAX,
  AUTOMATION_MAX_DEPTH,
  AUTOMATION_RULES_MAX,
  AUTOMATION_TRIGGERS,
  type AutomationAction,
  type AutomationCondition,
  automationAction,
  CONDITION_FIELDS,
  CONDITION_OPS,
} from './automation.ts';
export * from './contract.ts';
export { DISCUSSION_LIMIT, DISCUSSION_PREVIEW_CHARS } from './discussion.ts';
export {
  EXPORT_KEEP_DAYS,
  EXPORT_LINK_MINUTES,
  EXPORT_STATUSES,
  EXPORTS_SHOWN,
} from './exports.ts';
export {
  CELEBRATION_KINDS,
  type CelebrationKind,
  PROJECT_HEALTH_STATES,
  type ProjectHealthState,
} from './feed-highlights.ts';
export {
  OFFLINE_DUPLICATE_EVALUATION,
  SUGGESTION_ACTIONS,
  SUGGESTION_KINDS,
} from './feedback.ts';
export { PULL_REQUEST_STATES } from './github.ts';
export {
  IMPORT_CSV_MAX_BYTES,
  IMPORT_PROBLEMS_SHOWN,
  IMPORT_ZIP_MAX_BYTES,
} from './imports.ts';
export {
  HEALTH_HOURS,
  INSIGHT_MIN_SAMPLE,
  INSIGHT_WEEKS,
  INSTRUMENT_BOUNDS_MS,
  INSTRUMENTS,
  type Instrument,
  QUEUED_FOR_HEADER,
  SUGGESTION_DAYS,
} from './insights.ts';
export {
  BULK_ISSUES_MAX,
  BULK_SKIP_REASONS,
  type BulkChange,
} from './issues-bulk.ts';
export { ISSUE_LABELS_MAX } from './labels.ts';
export { MY_MEETINGS_LIMIT, MY_MEETINGS_MAX_HOURS } from './meetings.ts';
export { TOKEN_LIFETIMES, TOKEN_SCOPES, TOKENS_MAX } from './personal-tokens.ts';
export { SAVED_VIEWS_PER_PROJECT } from './saved-views.ts';
export {
  WEBHOOK_ATTEMPTS,
  WEBHOOK_DELIVERIES_SHOWN,
  WEBHOOK_EVENT_NAMES,
  WEBHOOK_EVENTS,
  WEBHOOKS_MAX,
  type WebhookEvent,
} from './webhooks.ts';
export { WEEK_WINDOW_MAX_HOURS } from './week.ts';

/** Every route the API serves through a contract, by name. */
export const contracts = {
  ...workspaceContracts,
  ...projectContracts,
  ...memberContracts,
  ...agentContracts,
  ...feedbackContracts,
  ...labelContracts,
  ...savedViewContracts,
  ...issueContracts,
  ...discussionContracts,
  ...bulkIssueContracts,
  ...documentContracts,
  ...channelContracts,
  ...meetingContracts,
  ...notificationContracts,
  ...notificationSettingContracts,
  ...unsubscribeContracts,
  ...pushContracts,
  ...auditContracts,
  ...overviewContracts,
  ...attachmentContracts,
  ...authContracts,
  ...twoFactorContracts,
  ...passkeyContracts,
  ...storyContracts,
  ...profileContracts,
  ...feedContracts,
  ...feedHighlightContracts,
  ...insightContracts,
  ...calendarContracts,
  ...automationContracts,
  ...weekContracts,
  ...accountContracts,
  ...exportContracts,
  ...importContracts,
  ...webhookContracts,
  ...personalTokenContracts,
  ...githubContracts,
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
/** The API reference as Markdown, from the same contracts (C7). */
export const apiReferenceMarkdown = (table: Record<string, Contract> = contracts) =>
  apiReference(table);

export function openApiDocument(table: Record<string, Contract> = contracts) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [name, route] of Object.entries(table)) {
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
        : route.rawBody
          ? {
              requestBody: {
                required: true,
                content: { [route.rawBody]: { schema: { type: 'string', format: 'binary' } } },
              },
            }
          : {}),
      responses: Object.fromEntries(
        statusesOf(route).map((status) => [
          String(status),
          route.response
            ? {
                description: 'OK',
                content: { 'application/json': { schema: jsonSchema(route.response, 'output') } },
              }
            : { description: 'No content' },
        ]),
      ),
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
