// Live smoke test for the extension auth core against a RUNNING ArcDrop
// instance. Not part of CI — run manually during development:
//   $env:ARCDROP__SMOKE_EMAIL='...'; $env:ARCDROP__SMOKE_PASSWORD='...'
//   bun --cwd=extension run smoke:auth
// Requires an existing, non-2FA account on the target instance.

import * as authApi from '../shared/authApi';
import { deviceLabel } from '../shared/deviceLabel';

const baseUrl = (process.env['ARCDROP__API_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '');
const email = process.env['ARCDROP__SMOKE_EMAIL'];
const password = process.env['ARCDROP__SMOKE_PASSWORD'];

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!email || !password) {
    fail('Set ARCDROP__SMOKE_EMAIL and ARCDROP__SMOKE_PASSWORD.');
  }

  console.log(`· validating ${baseUrl}`);
  await authApi.validateServer(baseUrl);

  console.log('· logging in');
  const outcome = await authApi.login(baseUrl, { email, password, deviceLabel: deviceLabel() });
  if (outcome.kind !== 'authenticated') {
    fail('TOTP challenge returned — the smoke script expects a non-2FA account.');
  }
  const session = outcome.session;
  console.log(`· signed in as ${session.user.email}`);

  console.log('· fetching /auth/me with the access token');
  const me = await authApi.fetchMe(baseUrl, session.accessToken);
  if (me.id !== session.user.id) {
    fail('/auth/me returned a different user.');
  }

  console.log('· refreshing the session');
  const refreshed = await authApi.refresh(baseUrl, session.refreshToken);
  if (refreshed.refreshToken === session.refreshToken) {
    fail('refresh did not rotate the refresh token.');
  }

  console.log('· logging out');
  await authApi.logout(baseUrl, refreshed.refreshToken);

  console.log('· confirming the revoked token no longer refreshes');
  const revoked = await authApi.refresh(baseUrl, refreshed.refreshToken).then(
    () => false,
    (error: unknown) => error instanceof Error,
  );
  if (!revoked) {
    fail('logout did not revoke the refresh token.');
  }

  console.log('✓ auth smoke passed');
}

void main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
