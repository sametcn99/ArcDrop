/**
 * Private/loopback/link-local address classification (plan M6 — SSRF
 * hardening). Pure and dependency-free — the same discipline as the
 * hand-rolled JWT service: the ranges are few, the bit math is simple, and
 * a dependency would only obscure what must be auditable.
 *
 * Blocked IPv4 ranges (ticket M6):
 * - `0.0.0.0/8`        — "this host" (the ticket names `0.0.0.0`; the /8 is
 *                        the historical class-A block around it)
 * - `10.0.0.0/8`       — RFC 1918 private
 * - `127.0.0.0/8`      — loopback
 * - `169.254.0.0/16`   — link-local (incl. the cloud-metadata address
 *                        `169.254.169.254`)
 * - `172.16.0.0/12`    — RFC 1918 private
 * - `192.168.0.0/16`   — RFC 1918 private
 *
 * Blocked IPv6 ranges / forms:
 * - `::1`              — loopback
 * - `::`               — unspecified address
 * - `fc00::/7`         — unique-local addresses (ULA)
 * - `fe80::/10`        — link-local
 * - `::ffff:0:0/96`    — IPv4-mapped: the embedded IPv4 is re-checked
 *                        against the IPv4 ranges above
 * - `::/96`            — deprecated IPv4-compatible form, same re-check
 *
 * Everything else (normal global unicast, including NAT64 `64:ff9b::/96`)
 * is allowed. Fail-closed lives one layer up: a hostname that cannot be
 * resolved is refused by the fetcher, not waved through here.
 */

/** Parses a dotted-quad IPv4 string; returns the 32-bit value or null. */
export function parseIPv4(ip: string): number | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!match) return null;
  let value = 0;
  for (const group of match.slice(1) as string[]) {
    const octet = Number(group);
    if (!Number.isInteger(octet) || octet > 255) return null;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

/**
 * Expands an IPv6 string into its eight 16-bit groups (numbers). Accepts
 * `::` compression (at most one) and a trailing embedded IPv4 (the
 * IPv4-mapped / IPv4-compatible / link-local-with-IPv4 forms). Returns
 * null when the string is not valid IPv6.
 */
export function parseIPv6(ip: string): number[] | null {
  const lower = ip.toLowerCase().split('%')[0] ?? ip.toLowerCase(); // strip a zone suffix (%eth0)

  // Split off an embedded IPv4 tail (last 32 bits, written dotted).
  let core = lower;
  const lastColon = lower.lastIndexOf(':');
  if (lastColon >= 0 && lower.includes('.', lastColon)) {
    const tail = lower.slice(lastColon + 1);
    const v4 = parseIPv4(tail);
    if (v4 === null) return null;
    core = `${lower.slice(0, lastColon)}:${hex16(v4 >>> 16)}:${hex16(v4 & 0xffff)}`;
  }

  const doubleColon = core.split('::');
  if (doubleColon.length > 2) return null; // at most one "::"

  let head: string[];
  let tail: string[];
  if (doubleColon.length === 2) {
    const [left = '', right = ''] = doubleColon;
    if (left === '' && right === '') return [0, 0, 0, 0, 0, 0, 0, 0]; // "::"
    head = left === '' ? [] : left.split(':');
    tail = right === '' ? [] : right.split(':');
    if (head.some((g) => g === '') || tail.some((g) => g === '')) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null; // "::" must stand for at least one group
    const headGroups = parseGroups(head);
    const tailGroups = parseGroups(tail);
    if (headGroups === null || tailGroups === null) return null;
    return [...headGroups, ...new Array<number>(missing).fill(0), ...tailGroups];
  }

  head = core.split(':');
  if (head.length !== 8) return null;
  return parseGroups(head);
}

const hex16 = (value: number): string => value.toString(16);

function parseGroups(groups: string[]): number[] | null {
  const out: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    out.push(parseInt(group, 16));
  }
  return out;
}

const inMask = (value: number, prefix: number, bits: number): boolean => {
  // Shift out the host bits and compare the network part. `prefix` is
  // already 16-bit aligned here (bit math over 16-bit groups).
  const mask = (0xffff << (16 - bits)) & 0xffff;
  return (value & mask) >>> 0 === (prefix & mask);
};

export function isPrivateIPv4(ip: string): boolean {
  const value = parseIPv4(ip);
  if (value === null) return false;
  return (
    value >>> 24 === 0 || // 0.0.0.0/8
    value >>> 24 === 10 || // 10.0.0.0/8
    value >>> 24 === 127 || // 127.0.0.0/8
    value >>> 16 === 0xa9fe || // 169.254.0.0/16 (incl. 169.254.169.254)
    value >>> 20 === 0xac1 || // 172.16.0.0/12 (top 12 bits of 172.16)
    value >>> 16 === 0xc0a8 // 192.168.0.0/16
  );
}

export function isPrivateIPv6(ip: string): boolean {
  const groups = parseIPv6(ip);
  if (groups === null) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    // :: and the deprecated ::/96 IPv4-compatible form — re-check the
    // embedded IPv4 (groups 6+7) against the IPv4 rules.
    if (g6 === 0 && g7 === 1) return true; // ::1 loopback
    const embedded = ((g6 << 16) | g7) >>> 0;
    if (embedded === 0) return true; // "::" unspecified
    const dotted = [
      embedded >>> 24,
      (embedded >>> 16) & 0xff,
      (embedded >>> 8) & 0xff,
      embedded & 0xff,
    ].join('.');
    return isPrivateIPv4(dotted);
  }

  if (inMask(g0, 0xfc00, 7)) return true; // fc00::/7 unique-local
  if (inMask(g0, 0xfe80, 10)) return true; // fe80::/10 link-local

  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    // ::ffff:0:0/96 IPv4-mapped — judge by the embedded IPv4 address.
    const embedded = ((g6 << 16) | g7) >>> 0;
    const dotted = [
      embedded >>> 24,
      (embedded >>> 16) & 0xff,
      (embedded >>> 8) & 0xff,
      embedded & 0xff,
    ].join('.');
    return isPrivateIPv4(dotted);
  }

  return false;
}

/** `true` when the address (v4 or v6) must not be connected to. */
export function isPrivateAddress(ip: string): boolean {
  return isPrivateIPv4(ip) || isPrivateIPv6(ip);
}
