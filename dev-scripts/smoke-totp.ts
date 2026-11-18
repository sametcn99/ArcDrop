// Live smoke test for the FULL two-factor login flow against a RUNNING
// ArcDrop instance. Not part of CI — run manually during development:
//   $env:ARCDROP__SMOKE_EMAIL='...'; $env:ARCDROP__SMOKE_PASSWORD='...'
//   bun --cwd=extension run smoke:totp
// Requires the credentials of an ADMIN account (it creates a disposable
// second user via POST /admin/users, claims it, enables TOTP on it, and
// exercises login → 401 TOTP_REQUIRED → /auth/login/tfa).

import { createHmac } from 'node:crypto';
import * as authApi from '../extension/shared/authApi';
import { deviceLabel } from '../extension/shared/deviceLabel';

const baseUrl = (process.env['ARCDROP__API_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '');
const adminEmail = process.env['ARCDROP__SMOKE_EMAIL'];
const adminPassword = process.env['ARCDROP__SMOKE_PASSWORD'];
const STAMP = Date.now().toString(36);
const NEW_EMAIL = `totp-smoke-${STAMP}@example.com`;
const NEW_PASSWORD = 'totp-smoke-password-123';

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Uint8Array {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const character of input.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32.indexOf(character);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s step) for the current time step. */
function totp(secretBase32: string, step = Math.floor(Date.now() / 1000 / 30)): string {
  const key = base32Decode(secretBase32);
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (binary % 1_000_000).toString().padStart(6, '0');
}

async function main(): Promise<void> {
  if (!adminEmail || !adminPassword) {
    fail('Set ARCDROP__SMOKE_EMAIL and ARCDROP__SMOKE_PASSWORD (an admin account).');
  }

  const adminOutcome = await authApi.login(baseUrl, {
    email: adminEmail,
    password: adminPassword,
    deviceLabel: deviceLabel(),
  });
  if (adminOutcome.kind !== 'authenticated') fail('admin login failed');
  const adminAuth = { accessToken: adminOutcome.session.accessToken };

  // 1. Create the disposable user and claim the invite.
  const created = await fetch(`${baseUrl}/api/v1/admin/users`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${adminAuth.accessToken}`,
    },
    body: JSON.stringify({ email: NEW_EMAIL }),
  });
  if (!created.ok) fail(`admin user creation failed: ${await created.text()}`);
  const { invite } = (await created.json()) as { invite: { token: string } };
  const claimed = await authApi.claim(baseUrl, { token: invite.token, password: NEW_PASSWORD });
  console.log(`· created + claimed ${NEW_EMAIL}`);

  // 2. Enable TOTP on the new user with a freshly computed code.
  const setup = await authApi.setupTfa(baseUrl, claimed.accessToken);
  await authApi.enableTfa(baseUrl, claimed.accessToken, { code: totp(setup.secret) });
  console.log('· TOTP enabled');

  // 3. Login → expect the 401 TOTP_REQUIRED challenge (the popup path).
  const firstAttempt = await authApi.login(baseUrl, {
    email: NEW_EMAIL,
    password: NEW_PASSWORD,
    deviceLabel: deviceLabel(),
  });
  if (firstAttempt.kind !== 'totp_required') {
    fail(`expected totp_required, got ${firstAttempt.kind}`);
  }
  console.log('· login bounced into the TOTP challenge');

  // 4. Wrong code is rejected (the popup error path).
  const rejected = await authApi
    .loginTfa(baseUrl, { challenge: firstAttempt.challenge, code: '000000' })
    .then(
      () => false,
      (error: unknown) => error instanceof Error,
    );
  if (!rejected) fail('a wrong TOTP code was accepted');

  // 5. Correct code (fresh step) completes the sign-in.
  const session = await authApi.loginTfa(baseUrl, {
    challenge: firstAttempt.challenge,
    code: totp(setup.secret),
  });
  if (session.user.email !== NEW_EMAIL) fail('2FA sign-in returned the wrong user');
  console.log('· challenge + TOTP code completed the sign-in');

  console.log('✓ TOTP smoke passed');
}

void main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
