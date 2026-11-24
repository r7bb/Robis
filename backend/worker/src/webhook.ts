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

/** IPv4 ranges that are not the public internet (RFC 6890 and friends). */
function privateV4(a: number, b: number, c: number): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** The eight 16-bit groups of an IPv6 address, with "::" and a dotted tail expanded. */
function groupsOf(address: string): number[] | null {
  let text = address.toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted[1]!.split('.').map(Number) as [number, number, number, number];
    text = `${text.slice(0, -dotted[1]!.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::') as [string, string | undefined];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = tail === undefined ? 0 : 8 - left.length - right.length;
  const groups = [...left, ...Array<string>(fill).fill('0'), ...right].map((g) =>
    Number.parseInt(g, 16),
  );
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)
    ? groups
    : null;
}

/**
 * Whether an address is one the internet can reach, not a private one.
 * IPv6 is allowed only in global unicast (2000::/3), and not where it can
 * carry an IPv4 address or is set aside (6to4, NAT64, Teredo, docs);
 * an IPv4 address written as IPv6 (::ffff:a.b.c.d, in any form) is judged
 * as the IPv4 address it is.
 */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number) as [number, number, number];
    return !privateV4(a, b, c);
  }
  if (isIP(address) !== 6) return false;
  const groups = groupsOf(address);
  if (!groups) return false;
  const [g0, g1, , , , g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  // ::ffff:a.b.c.d, however written: the IPv4 address decides.
  if (groups.slice(0, 5).every((g) => g === 0) && g5 === 0xffff) {
    return !privateV4(g6 >> 8, g6 & 0xff, g7 >> 8);
  }
  if ((g0 & 0xe000) !== 0x2000) return false;
  if (g0 === 0x2002) return false;
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) return false;
  return !(g0 === 0x0064 && g1 === 0xff9b);
}

/** How long a name may take to resolve before the send counts as failed. */
const LOOKUP_MS = 3_000;

async function resolveAll(host: string): Promise<string[]> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('the name took too long to resolve')), LOOKUP_MS),
  );
  const found = await Promise.race([lookup(host, { all: true }), timeout]);
  return found.map((entry) => entry.address);
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
  const addresses = isIP(host) ? [host] : await resolveAll(host);
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
  await response.body?.cancel();
  if (!response.ok) throw new Error(`webhook answered ${response.status}`);
};

export const webhookHandlers = { [AUTOMATION_WEBHOOK_JOB]: sendWebhook };
