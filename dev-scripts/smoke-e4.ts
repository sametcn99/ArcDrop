// Live verification for the E4 server contracts against a RUNNING ArcDrop
// API. Not part of CI — run manually:
//   $env:ARCDROP__SMOKE_EMAIL='...'; $env:ARCDROP__SMOKE_PASSWORD='...'
//   bun --cwd=extension run smoke:e4
// Covers the flows the context menus use: image upload (POST
// /bookmarks/file multipart, incl. the SVG rejection), selection append
// (PUT excerpt), and sequential bulk-style creates with find-by-url skips.

import * as authApi from '../extension/shared/authApi';
import * as bookmarksApi from '../extension/shared/api/bookmarks';
import { apiFetch } from '../extension/shared/apiFetch';
import { appendSelectionToExcerpt } from '../extension/shared/menuActions';
import { deviceLabel } from '../extension/shared/deviceLabel';

const baseUrl = (process.env['ARCDROP__API_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '');
const email = process.env['ARCDROP__SMOKE_EMAIL'];
const password = process.env['ARCDROP__SMOKE_PASSWORD'];
const STAMP = Date.now().toString(36);

/** 1×1 transparent PNG. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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

  // 1. Image upload via POST /bookmarks/file (the "save image" flow).
  const pngBytes = Buffer.from(PNG_BASE64, 'base64');
  const form = new FormData();
  form.append('file', new File([pngBytes], `smoke-${STAMP}.png`, { type: 'image/png' }));
  form.append('title', `Image smoke ${STAMP}`);
  const uploaded = await bookmarksApi.uploadBookmarkImage(
    baseUrl,
    form.get('file') as File,
    {},
    auth,
  );
  if (uploaded.storageKind !== 'file' || uploaded.contentType !== 'image') {
    fail(`upload produced unexpected bookmark: ${uploaded.storageKind}/${uploaded.contentType}`);
  }
  const imageId = uploaded.id;
  console.log(`· image uploaded (file bookmark ${imageId}, ${uploaded.contentType})`);

  // 2. SVG must be refused by the API (the extension blocks it earlier too).
  const svgForm = new FormData();
  svgForm.append('file', new File([new Blob(['<svg/>'])], 'evil.svg', { type: 'image/svg+xml' }));
  const svgRejected = await apiFetch(`${baseUrl}/api/v1/bookmarks/file`, {
    method: 'POST',
    body: svgForm,
    accessToken: auth.accessToken,
  }).then(
    () => false,
    () => true,
  );
  if (!svgRejected) fail('SVG upload was accepted — expected rejection');
  console.log('· SVG upload rejected as expected');

  // 3. Selection append (PUT excerpt with the append semantics).
  const pageUrl = `https://smoke.example/selection-${STAMP}`;
  const created = await bookmarksApi.createBookmark(
    baseUrl,
    {
      url: pageUrl,
      title: `Selection smoke ${STAMP}`,
      excerpt: 'Original summary',
      favorite: false,
    },
    auth,
  );
  const appended = appendSelectionToExcerpt(created.excerpt, 'A saved quote');
  if (!appended.changed) fail('append reported no change');
  const withSelection = await bookmarksApi.updateBookmark(
    baseUrl,
    created.id,
    { excerpt: appended.excerpt },
    auth,
  );
  if (
    !withSelection.excerpt?.includes('Original summary') ||
    !withSelection.excerpt.includes('A saved quote')
  ) {
    fail('selection append did not persist');
  }
  const repeated = appendSelectionToExcerpt(withSelection.excerpt, 'A saved quote');
  if (repeated.changed) fail('repeat append is not idempotent');
  console.log('· selection append + idempotency ok');

  // 4. Bulk-style sequential creates + find-by-url skips (save all tabs).
  const urls = [
    `https://smoke.example/tab-a-${STAMP}`,
    `https://smoke.example/tab-b-${STAMP}`,
    `https://smoke.example/tab-a-${STAMP}`, // same-URL duplicate
  ];
  const seen = new Set<string>();
  let savedCount = 0;
  let skippedCount = 0;
  const createdIds: string[] = [];
  for (const url of urls) {
    if (seen.has(url)) {
      skippedCount += 1;
      continue;
    }
    seen.add(url);
    const existing = await bookmarksApi.findBookmarkByUrl(baseUrl, url, auth);
    if (existing) {
      skippedCount += 1;
      continue;
    }
    const bookmark = await bookmarksApi.createBookmark(baseUrl, { url, favorite: false }, auth);
    createdIds.push(bookmark.id);
    savedCount += 1;
  }
  if (savedCount !== 2 || skippedCount !== 1) {
    fail(`bulk summary wrong: saved=${savedCount} skipped=${skippedCount}`);
  }
  console.log('· bulk-style save: 2 saved, 1 duplicate skipped');

  // Cleanup: trash everything the smoke created.
  for (const id of [imageId, created.id, ...createdIds]) {
    await bookmarksApi.trashBookmark(baseUrl, id, auth);
  }
  console.log('· cleanup trashed all created bookmarks');

  console.log('✓ E4 smoke passed');
}

void main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
