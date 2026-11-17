import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBanMessage, isBanStatusActive } from './ban';
import {
  extractClientIp,
  formatBanMessage as serverFormatBanMessage,
  isBanActive,
  networkKeyFromIp,
  sanitizeBanReason,
} from '../../functions/src/banPure';

test('ban message matches the player-facing Error 600 copy', () => {
  const reason = 'cheating in the lobby';
  const expected = 'Error 600, you have been ban from this game (Reason: cheating in the lobby)';
  assert.equal(formatBanMessage(reason), expected);
  assert.equal(serverFormatBanMessage(reason), expected);
  assert.equal(formatBanMessage(reason), serverFormatBanMessage(reason));
});

test('temporal ban is active only until the end timestamp', () => {
  const now = 1_700_000_000_000;
  assert.equal(isBanActive({ permanent: true, endsAtMs: now - 1 }, now), true);
  assert.equal(isBanActive({ permanent: false, endsAtMs: now + 1000 }, now), true);
  assert.equal(isBanActive({ permanent: false, endsAtMs: now }, now), false);
  assert.equal(isBanActive({ permanent: false, endsAtMs: null }, now), false);
  assert.equal(isBanStatusActive({ reason: 'x', permanent: false, endsAtMs: now + 5 }, now), true);
  assert.equal(isBanStatusActive({ reason: 'x', permanent: false, endsAtMs: now - 5 }, now), false);
  assert.equal(isBanStatusActive(null, now), false);
});

test('reason text is trimmed into one line', () => {
  assert.equal(sanitizeBanReason('  too   many\nlines  '), 'too many lines');
  assert.equal(sanitizeBanReason('   '), null);
  assert.equal(sanitizeBanReason(12), null);
  assert.equal(sanitizeBanReason('a'.repeat(281)), null);
});

test('network key is the observed public IPv4 or IPv6 /64', () => {
  assert.equal(networkKeyFromIp('203.0.113.10'), 'ip4:203.0.113.10');
  assert.equal(networkKeyFromIp('::ffff:203.0.113.10'), 'ip4:203.0.113.10');
  assert.equal(networkKeyFromIp('127.0.0.1'), 'ip4:127.0.0.1');
  assert.equal(
    networkKeyFromIp('2001:db8:85a3:0000:0000:8a2e:0370:7334'),
    'ip6:2001:db8:85a3:0',
  );
  assert.equal(
    networkKeyFromIp('2001:db8:85a3::8a2e:370:7334'),
    networkKeyFromIp('2001:db8:85a3:0:1111:2222:3333:4444'),
  );
  assert.notEqual(
    networkKeyFromIp('2001:db8:85a3::1'),
    networkKeyFromIp('2001:db8:85a4::1'),
  );
  assert.equal(networkKeyFromIp('::1'), 'ip6:0:0:0:0');
  assert.equal(networkKeyFromIp('not an ip'), null);
});

test('client IP prefers the platform hop over a spoofed forwarding header', () => {
  assert.equal(
    extractClientIp({
      headers: {
        'x-appengine-user-ip': '198.51.100.20',
        'x-forwarded-for': '1.2.3.4, 203.0.113.8',
      },
      ip: '10.0.0.1',
    }),
    '198.51.100.20',
  );
  assert.equal(
    extractClientIp({
      headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.8' },
      ip: '10.0.0.1',
    }),
    '203.0.113.8',
  );
  assert.equal(extractClientIp({ ip: '::ffff:192.0.2.15' }), '192.0.2.15');
  assert.equal(
    extractClientIp({
      headers: { 'x-forwarded-for': 'not-an-ip' },
      socket: { remoteAddress: '::ffff:127.0.0.1' },
    }),
    '127.0.0.1',
  );
  assert.equal(networkKeyFromIp(extractClientIp({ ip: '::ffff:192.0.2.15' })), 'ip4:192.0.2.15');
});
