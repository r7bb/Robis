import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  AUTOMATION_WEBHOOK_JOB,
  type AutomationWebhookJob,
  automationRules,
  type Database,
} from '@robis/database';
import { and, eq } from 'drizzle-orm';

/**
 * A rule's outgoing webhook (B9). The address is an administrator's, so
 * it is checked before every send: https on the default port, and every
 * address its name resolves to outside private, loopback, link-local and
 * shared ranges, so a rule cannot be pointed at the server's own network.
 * The body holds ids, never words, signed with the rule's secret; no
 * redirect is followed; five seconds, then the job retries with backoff.
 *
 * Left open: the name is resolved once for the check and again by the
 * connection, so a name that changes its answer in between (DNS
 * rebinding) is not caught. See docs/THREAT_MODEL.md.
 */

const TIMEOUT_MS = 5_000;

/** Whether an address is one the internet can reach, not a private one. */
export function isPublicAddress(address: string): boolean {
  const v4 = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number) as [number, number];
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (isIP(address) !== 6) return false;
  const lower = address.toLowerCase();
  return !(lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower));
}

/** Why an address may not be sent to, or null when it may. */
export async function refusalFor(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'not an address';
  }
  if (parsed.protocol !== 'https:' || (parsed.port !== '' && parsed.port !== '443')) {
    return 'only https on the default port';
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    return 'it resolves to an address inside a private network';
  }
  return null;
}

export function signature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export const sendWebhook = async (payload: unknown, { db }: { db: Database }) => {
  const job = payload as AutomationWebhookJob;
  const [rule] = await db
    .select({
      name: automationRules.name,
      action: automationRules.action,
      enabled: automationRules.enabled,
    })
    .from(automationRules)
    .where(
      and(eq(automationRules.id, job.ruleId), eq(automationRules.workspaceId, job.workspaceId)),
    );
  const action = rule?.action as { kind?: string; url?: string; secret?: string } | undefined;
  // Removed, turned off, or no longer a webhook since: nothing to send.
  if (!rule?.enabled || action?.kind !== 'webhook' || !action.url || !action.secret) return;

  const refused = await refusalFor(action.url);
  if (refused) throw new Error(`webhook not sent: ${refused}`);

  const body = JSON.stringify({
    rule: { id: job.ruleId, name: rule.name },
    trigger: job.trigger,
    eventId: job.eventId,
    issue: { id: job.issueId, key: job.issueKey },
    sentAt: new Date().toISOString(),
  });
  const response = await fetch(action.url, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Robis-Automation/1',
      'x-robis-event': job.eventId,
      'x-robis-signature': signature(action.secret, body),
    },
    body,
  });
  if (!response.ok) throw new Error(`webhook answered ${response.status}`);
};

export const webhookHandlers = { [AUTOMATION_WEBHOOK_JOB]: sendWebhook };
