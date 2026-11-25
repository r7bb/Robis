import type { SaphaParts } from '@robis/shared';

/**
 * Assistance (D3) as a job: the API cannot talk to the language-model
 * provider (only the worker holds that port), so an ask is a row plus a job.
 * These are the shapes both sides agree on.
 */

export const ASSIST_JOB = 'assist.ask';
export type AssistJob = { requestId: string };

/** Sapha, the agent: answer one pending turn of a conversation. */
export const SAPHA_REPLY_JOB = 'sapha.reply';
export type SaphaReplyJob = { messageId: string };
/** Conversations past their 30 days, cleared hourly. */
export const SAPHA_RETENTION_JOB = 'sapha.retention';

export type AssistSnippet = { id: string; author: string; text: string };
export type AssistIssue = {
  id: string;
  key: string;
  title: string;
  status: string;
  description: string | null;
};

export type AssistInput =
  | { kind: 'summary'; subject: string; snippets: AssistSnippet[] }
  | { kind: 'agenda'; meeting: string; issues: AssistIssue[] }
  | { kind: 'issue'; message: string }
  /** Sapha, tier 1: a request tier 0 could not read. */
  | { kind: 'intent'; request: string };

export type AssistResult =
  | { kind: 'summary'; points: { text: string; sources: string[] }[] }
  | {
      kind: 'agenda';
      items: { text: string; issueIds: string[] }[];
      issues: { id: string; key: string; title: string }[];
    }
  | { kind: 'issue'; title: string; priority: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' }
  | { kind: 'intent'; parts: SaphaParts };
