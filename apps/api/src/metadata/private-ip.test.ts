import { describe, expect, it } from 'bun:test';
import {
  isPrivateAddress,
  isPrivateIPv4,
  isPrivateIPv6,
  parseIPv4,
  parseIPv6,
} from './private-ip';

/**
 * The SSRF blocklist matrix (ticket M6): every range the ticket names,
 * its boundaries, and representative public addresses that must stay
 * fetchable. This is the audit trail for the security posture — if a
 * range moves, this file moves with it.
 */
describe('private-ip', () => {
  describe('parseIPv4', () => {
    it('parses dotted quads and rejects malformed input', () => {
      expect(parseIPv4('192.168.1.1')).toBe(((192 << 24) | (168 << 16) | (1 << 8) | 1) >>> 0);
      expect(parseIPv4('0.0.0.0')).toBe(0);
      expect(parseIPv4('255.255.255.255')).toBe(0xffffffff);
      expect(parseIPv4('256.1.1.1')).toBeNull();
      expect(parseIPv4('1.2.3')).toBeNull();
      expect(parseIPv4('1.2.3.4.5')).toBeNull();
      expect(parseIPv4('a.b.c.d')).toBeNull();
      expect(parseIPv4('')).toBeNull();
    });
  });

  describe('parseIPv6', () => {
    it('expands compressed forms', () => {
      expect(parseIPv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
      expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
      expect(parseIPv6('fe80::1')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
      expect(parseIPv6('fc00::')).toEqual([0xfc00, 0, 0, 0, 0, 0, 0, 0]);
      expect(parseIPv6('fd12:3456:789a:bcde:f012:3456:789a:bcde')).toEqual([
        0xfd12, 0x3456, 0x789a, 0xbcde, 0xf012, 0x3456, 0x789a, 0xbcde,
      ]);
      expect(parseIPv6('2606:4700::6810:84e5')).toEqual([0x2606, 0x4700, 0, 0, 0, 0, 0x6810, 0x84e5]);
    });

    it('handles embedded IPv4 tails', () => {
      expect(parseIPv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
      expect(parseIPv6('::127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0, 0x7f00, 1]);
      expect(parseIPv6('::ffff:8.8.8.8')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0808, 0x0808]);
    });

    it('rejects garbage', () => {
      expect(parseIPv6('1::2::3')).toBeNull();
      expect(parseIPv6('1:2:3:4:5:6:7:8:9')).toBeNull();
      expect(parseIPv6('g::1')).toBeNull();
      expect(parseIPv6('1:2:3:4:5:6:7:8::')).toBeNull();
      expect(parseIPv6('192.168.1.1')).toBeNull(); // plain IPv4 is not IPv6
    });

    it('ignores zone suffixes', () => {
      expect(parseIPv6('fe80::1%eth0')).toEqual(parseIPv6('fe80::1'));
    });
  });

  describe('isPrivateIPv4 — the ticket ranges and their boundaries', () => {
    const blocked: Array<[string, string]> = [
      ['0.0.0.0/8', '0.0.0.0'],
      ['0.0.0.0/8 top', '0.255.255.255'],
      ['10/8 low', '10.0.0.0'],
      ['10/8 high', '10.255.255.255'],
      ['127/8 low', '127.0.0.0'],
      ['127/8 mid', '127.200.9.9'],
      ['127/8 high', '127.255.255.255'],
      ['169.254/16 low', '169.254.0.0'],
      ['169.254/16 metadata', '169.254.169.254'],
      ['169.254/16 high', '169.254.255.255'],
      ['172.16/12 low', '172.16.0.0'],
      ['172.16/12 mid', '172.20.1.2'],
      ['172.16/12 high', '172.31.255.255'],
      ['192.168/16 low', '192.168.0.0'],
      ['192.168/16 high', '192.168.255.255'],
    ];
    for (const [label, ip] of blocked) {
      it(`blocks ${label} (${ip})`, () => {
        expect(isPrivateIPv4(ip)).toBeTrue();
        expect(isPrivateAddress(ip)).toBeTrue();
      });
    }

    const allowed: Array<[string, string]> = [
      ['just outside 172.16/12 below', '172.15.255.255'],
      ['just outside 172.16/12 above', '172.32.0.0'],
      ['172 without the /12 (public-looking host octet)', '172.99.1.1'],
      ['just outside 10/8', '9.255.255.255'],
      ['just outside 10/8 above', '11.0.0.0'],
      ['just outside 127/8', '126.255.255.255'],
      ['just outside 127/8 above', '128.0.0.0'],
      ['just outside 169.254/16', '169.255.1.1'],
      ['just outside 192.168/16', '192.169.0.0'],
      ['plain public', '93.184.216.34'],
      ['plain public (1.1.1.1)', '1.1.1.1'],
      ['8.8.8.8', '8.8.8.8'],
    ];
    for (const [label, ip] of allowed) {
      it(`allows ${label} (${ip})`, () => {
        expect(isPrivateIPv4(ip)).toBeFalse();
        expect(isPrivateAddress(ip)).toBeFalse();
      });
    }
  });

  describe('isPrivateIPv6 — the ticket ranges and their boundaries', () => {
    const blocked: Array<[string, string]> = [
      ['::1 loopback', '::1'],
      [':: unspecified', '::'],
      ['fc00::/7 low', 'fc00::1'],
      ['fc00::/7 high', 'fdff::ffff'],
      ['ULA fd', 'fd12:3456::1'],
      ['fe80::/10 low', 'fe80::1'],
      ['fe80::/10 high', 'febf:ffff::ffff'],
      ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
      ['IPv4-mapped RFC1918', '::ffff:10.0.0.9'],
      ['IPv4-mapped link-local', '::ffff:169.254.169.254'],
      ['IPv4-compatible (deprecated) loopback', '::127.0.0.1'],
      ['fe80 with IPv4 tail', 'fe80::192.168.1.1'],
    ];
    for (const [label, ip] of blocked) {
      it(`blocks ${label} (${ip})`, () => {
        expect(isPrivateIPv6(ip)).toBeTrue();
        expect(isPrivateAddress(ip)).toBeTrue();
      });
    }

    const allowed: Array<[string, string]> = [
      ['global unicast', '2606:4700::6810:84e5'],
      ['just outside fe80::/10', 'fec0::1'],
      ['just outside fc00::/7 below', 'fbff::1'],
      ['just outside fc00::/7 above', 'fe00::1'],
      ['IPv4-mapped public', '::ffff:8.8.8.8'],
      ['IPv4-compatible (deprecated) public', '::8.8.8.8'],
      ['2002::/16 6to4', '2002:c058:6301::'],
    ];
    for (const [label, ip] of allowed) {
      it(`allows ${label} (${ip})`, () => {
        expect(isPrivateIPv6(ip)).toBeFalse();
        expect(isPrivateAddress(ip)).toBeFalse();
      });
    }
  });
});
