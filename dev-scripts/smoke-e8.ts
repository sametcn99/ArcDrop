// Live verification for the E8 web cover-picker contract against a RUNNING
// ArcDrop API. Not part of CI — run manually:
//   $env:ARCDROP__SMOKE_EMAIL='...'; $env:ARCDROP__SMOKE_PASSWORD='...'
//   bun --cwd=extension run smoke:e8
// Exercises POST /bookmarks/{id}/cover exactly as the web client sends it:
// cover assignment from a PUBLIC image URL, public icon serving of the
// stored ref, reassignment, and cleanup. (The SSRF pipeline refuses
// loopback/private image sources on real instances by design, so the image
// URL must be publicly reachable.)

import * as authApi from '../extension/shared/authApi';
import * as bookmarksApi from '../extension/shared/api/bookmarks';
import { deviceLabel } from '../extension/shared/deviceLabel';

const baseUrl = (process.env['ARCDROP__API_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '');
const email = process.env['ARCDROP__SMOKE_EMAIL'];
const password = process.env['ARCDROP__SMOKE_PASSWORD'];
const STAMP = Date.now().toString(36);
const COVER_URL = 'https://picsum.photos/seed/arcdrop-e8/300/200';

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!email || !password) fail('Set ARCDROP__SMOKE_EMAIL and ARCDROP__SMOKE_PASSWORD.');

  const outcome = await authApi.login(baseUrl, { email, password, deviceLabel: deviceLabel() });
  if (outcome.kind !== 'authenticated') fail('login failed');
  const auth = { accessToken: outcome.session.accessToken };
  console.log('· signed in');

  const pageUrl = `https://smoke.example/e8-${STAMP}`;
  const created = await bookmarksApi.createBookmark(
    baseUrl,
    { url: pageUrl, title: `E8 cover smoke ${STAMP}`, favorite: false },
    auth,
  );
  console.log(`· bookmark created (${created.id})`);

  // The web client's exact call shape: POST /bookmarks/{id}/cover {imageUrl}.
  const withCover = await bookmarksApi.setBookmarkCover(baseUrl, created.id, COVER_URL, auth);
  if (!withCover.coverRef || withCover.coverRef === created.coverRef) {
    fail('cover assignment did not produce a new coverRef');
  }
  const coverRef = withCover.coverRef as string;
  console.log(`· cover assigned (${coverRef})`);

  // The public icon surface must serve the stored bytes.
  const iconRes = await fetch(`${baseUrl}/api/v1/icons/${coverRef}`);
  const bytes = new Uint8Array(await iconRes.arrayBuffer());
  if (iconRes.status !== 200 || bytes.length === 0) {
    fail(`public icon serve failed: HTTP ${iconRes.status}`);
  }
  console.log(`· public icon surface serves the cover (${bytes.byteLength} bytes)`);

  // Reassignment from a second public source produces a different ref.
  const reassigned = await bookmarksApi.setBookmarkCover(
    baseUrl,
    created.id,
    'https://picsum.photos/seed/arcdrop-e8-second/300/200',
    auth,
  );
  if (reassigned.coverRef === coverRef) fail('reassignment reused the same ref');
  console.log('· reassignment produces a fresh ref');

  // SSRF guard: loopback image sources are refused on real instances.
  const loopbackRefused = await bookmarksApi
    .setBookmarkCover(baseUrl, created.id, 'http://127.0.0.1:9/x.png', auth)
    .then(
      () => false,
      () => true,
    );
  if (!loopbackRefused) fail('loopback image URL was accepted — SSRF guard off?');
  console.log('· loopback image source refused (SSRF guard live)');

  await bookmarksApi.trashBookmark(baseUrl, created.id, auth);
  console.log('· cleanup trashed the bookmark');

  console.log('✓ E8 cover smoke passed');
}

void main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
