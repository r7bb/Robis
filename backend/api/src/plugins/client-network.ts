import { isIPv4, isIPv6 } from 'node:net';

/**
 * Where a request comes from, as far as limits go (A6): an IPv4 address, or
 * the /64 an IPv6 one is in, since one household or server is usually
 * given a whole /64 and could otherwise move to a fresh address for every
 * try. An IPv4 address carried inside IPv6 (mapped as `::ffff:a.b.c.d` in
 * any spelling, or through NAT64's `64:ff9b::/96`) counts as that IPv4
 * address, not as one bucket shared by everyone arriving that way.
 * Anything that is not an address at all (only possible if a proxy is
 * trusted that should not be) is cut short and marked as such.
 */
export function networkOf(ip: string): string {
  const bare = (ip.replace(/^\[|\]$/g, '').split('%')[0] ?? '').toLowerCase();
  if (isIPv4(bare)) return bare;
  if (!isIPv6(bare)) return `not-an-address:${bare.slice(0, 64).replaceAll('|', '%7C')}`;
  const groups = groupsOf(bare);
  const embedded = embeddedIPv4(groups);
  if (embedded) return embedded;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/** The eight 16-bit groups of a valid IPv6 address, a trailing dotted quad turned into two. */
function groupsOf(address: string): string[] {
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address);
  const hex = dotted
    ? address.slice(0, dotted.index) +
      [Number(dotted[1]) * 256 + Number(dotted[2]), Number(dotted[3]) * 256 + Number(dotted[4])]
        .map((n) => n.toString(16))
        .join(':')
    : address;
  const [head = '', tail = ''] = hex.split('::');
  const front = head ? head.split(':') : [];
  const back = tail ? tail.split(':') : [];
  const missing = hex.includes('::') ? 8 - front.length - back.length : 0;
  return [...front, ...Array(Math.max(0, missing)).fill('0'), ...back].map((g) =>
    g.padStart(4, '0'),
  );
}

/** The IPv4 address an IPv4-mapped or NAT64 address carries, or null. */
function embeddedIPv4(groups: string[]): string | null {
  const mapped = groups.slice(0, 5).every((g) => g === '0000') && groups[5] === 'ffff';
  const nat64 =
    groups[0] === '0064' && groups[1] === 'ff9b' && groups.slice(2, 6).every((g) => g === '0000');
  if (!mapped && !nat64) return null;
  const [high = 0, low = 0] = [groups[6], groups[7]].map((g) => Number.parseInt(g ?? '0', 16));
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}
