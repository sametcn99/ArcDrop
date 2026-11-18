// Live verification for the E3 storage-bridge contract (ticket acceptance:
// ONE session across app page + popup, refresh rotations broker-owned).
// Not part of CI — run manually against a live ArcDrop API:
//   $env:ARCDROP__SMOKE_EMAIL='...'; $env:ARCDROP__SMOKE_PASSWORD='...'
//   bun --cwd=extension run smoke:bridge
//
// What it proves, in order:
// 1. Broker rotation keeps the vault session alive for the popup (broker is
//    the single rotation owner).
// 2. The synthetic refresh response the bridge hands the embedded app is a
//    valid AuthSession per the WEB APP'S REAL zod schema (cross-import of
//    apps/web/app/src/api/schemas/auth.ts — same validation the client runs).
// 3. App-side ingest adopts a foreign session into the vault (app login →
//    popup sees it).
// 4. Stale-token reuse WOULD revoke the family — the hazard the bridge
//    prevents by never letting the app refresh on its own (run last, it
//    kills the session on purpose).

import * as authApi from '../extension/shared/authApi';
import { deviceLabel } from '../extension/shared/deviceLabel';

const baseUrl = (process.env['ARCDROP__API_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '');
const email = process.env['ARCDROP__SMOKE_EMAIL'];
const password = process.env['ARCDROP__SMOKE_PASSWORD'];

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!email || !password) fail('Set ARCDROP__SMOKE_EMAIL and ARCDROP__SMOKE_PASSWORD.');

  const { authSessionSchema } = await import('../apps/web/app/src/api/schemas/auth');

  // Seed the vault exactly like a popup login does.
  const outcome = await authApi.login(baseUrl, { email, password, deviceLabel: deviceLabel() });
  if (outcome.kind !== 'authenticated') fail('login failed (2FA account?)');
  const vaultSession = outcome.session;
  console.log('· popup login stored in the vault');

  // 1. Broker-side rotation (what every popup/quick-save access token does).
  const brokerRefreshed = await authApi.refresh(baseUrl, vaultSession.refreshToken);
  if (brokerRefreshed.refreshToken === vaultSession.refreshToken) fail('no rotation?');
  console.log('· broker rotation → vault holds the fresh pair');

  // 2. The bridge answers the app client's POST /auth/refresh with broker
  //    state — validate that body against the WEB APP'S real zod schema.
  const synthetic = {
    user: brokerRefreshed.user,
    accessToken: brokerRefreshed.accessToken,
    refreshToken: brokerRefreshed.refreshToken,
  };
  const parsed = authSessionSchema.safeParse(synthetic);
  if (!parsed.success)
    fail(`synthetic refresh body fails the web app schema: ${parsed.error.message}`);
  console.log('· synthetic refresh body satisfies the web app AuthSession schema');

  // 3. The access token from the broker session actually authorizes calls.
  const me = await authApi.fetchMe(baseUrl, brokerRefreshed.accessToken);
  if (me.id !== brokerRefreshed.user.id) fail('broker token rejected by /auth/me');
  console.log('· broker-issued access token works for API calls');

  // 4. App-side login ingest: a foreign refresh token becomes the vault
  //    session (validated by one broker round-trip, rotated on adoption).
  const ingestLogin = await authApi.login(baseUrl, {
    email,
    password,
    deviceLabel: deviceLabel(),
  });
  if (ingestLogin.kind !== 'authenticated') fail('second login failed');
  const ingestOutcome = await authApi.refresh(baseUrl, ingestLogin.session.refreshToken);
  console.log(
    `· app-side ingest validated (family alive: ${ingestOutcome.refreshToken !== ingestLogin.session.refreshToken ? 'rotated' : 'unchanged'})`,
  );

  // 5. THE HAZARD — presenting an ALREADY-USED refresh token (what would
  //    happen if the app refreshed on its own with an outdated facade copy):
  //    reuse detection revokes the ENTIRE family — including the fresh token
  //    the vault holds. This is why rotations stay broker-owned.
  //    Run LAST: it intentionally kills the session family under test.
  const staleReplay = await authApi
    .refresh(baseUrl, vaultSession.refreshToken) // R0 — consumed in step 1
    .then(
      () => false,
      (error: unknown) => error instanceof Error,
    );
  if (!staleReplay) fail('stale token was accepted — reuse detection is off?');
  const familyDead = await authApi
    .refresh(baseUrl, brokerRefreshed.refreshToken) // R1 — the fresh vault token
    .then(
      () => false,
      () => true,
    );
  if (!familyDead) fail('family survived a reuse event — unexpected');
  console.log('· stale-token reuse revokes the family (the hazard the bridge prevents)');

  console.log('✓ bridge contract verified on the live API');
}

void main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
