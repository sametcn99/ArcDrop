// Live smoke test for the E2 bookmark flow against a RUNNING ArcDrop
// instance. Not part of CI — run manually during development:
//   $env:ARCDROP__SMOKE_EMAIL='...'; $env:ARCDROP__SMOKE_PASSWORD='...'
//   bun --cwd=extension run smoke:bookmarks
// Exercises: create (+collection query) → find-by-url (link: operator) →
// update → tags → collections replace → trash → gone from the active set.

import * as bookmarksApi from '../extension/shared/api/bookmarks';
import * as collectionsApi from '../extension/shared/api/collections';
import { deviceLabel } from '../extension/shared/deviceLabel';
import * as authApi from '../extension/shared/authApi';

const baseUrl = (process.env['ARCDROP__API_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '');
const email = process.env['ARCDROP__SMOKE_EMAIL'];
const password = process.env['ARCDROP__SMOKE_PASSWORD'];
const STAMP = Date.now().toString(36);
const URL_TO_SAVE = `https://smoke.example/${STAMP}`;

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!email || !password) {
    fail('Set ARCDROP__SMOKE_EMAIL and ARCDROP__SMOKE_PASSWORD.');
  }

  const outcome = await authApi.login(baseUrl, { email, password, deviceLabel: deviceLabel() });
  if (outcome.kind !== 'authenticated') {
    fail('TOTP challenge returned — the smoke script expects a non-2FA account.');
  }
  const auth = { accessToken: outcome.session.accessToken };
  console.log('· signed in');

  // Collection for the run.
  const tree = await collectionsApi.fetchCollectionTree(baseUrl, auth);
  const existing = tree.find((node) => node.title === 'Smoke Collection');
  const collection =
    existing ??
    (await collectionsApi.createCollection(baseUrl, { title: 'Smoke Collection' }, auth));
  console.log(`· collection ready (${collection.id})`);

  // Create with the quick-add collection query.
  const created = await bookmarksApi.createBookmark(
    baseUrl,
    { url: URL_TO_SAVE, title: `Smoke ${STAMP}`, favorite: false },
    { ...auth, collectionId: collection.id },
  );
  console.log(`· created ${created.id}`);

  // find-by-url via the link: operator + exact filter.
  const found = await bookmarksApi.findBookmarkByUrl(baseUrl, URL_TO_SAVE, auth);
  if (found === null || found.id !== created.id) {
    fail(`find-by-url did not return the created bookmark (${JSON.stringify(found?.id ?? null)}).`);
  }
  console.log('· find-by-url matched the exact URL');

  // Update + tags.
  const updated = await bookmarksApi.updateBookmark(
    baseUrl,
    created.id,
    { title: `Smoke ${STAMP} (edited)`, excerpt: 'Edited by smoke', favorite: true },
    auth,
  );
  if (!updated.favorite || updated.title !== `Smoke ${STAMP} (edited)`) {
    fail('update did not stick.');
  }
  const withTags = await bookmarksApi.replaceBookmarkTags(
    baseUrl,
    created.id,
    ['smoke', 'e2'],
    auth,
  );
  if (withTags.tags.length !== 2) {
    fail('tag replace failed.');
  }
  console.log('· update + tags ok');

  // Collections replace.
  await bookmarksApi.replaceBookmarkCollections(baseUrl, created.id, [collection.id], auth);
  console.log('· collections replace ok');

  // Trash → gone from the active set.
  await bookmarksApi.trashBookmark(baseUrl, created.id, auth);
  const afterTrash = await bookmarksApi.findBookmarkByUrl(baseUrl, URL_TO_SAVE, auth);
  if (afterTrash !== null) {
    fail('trashed bookmark is still visible in the active set.');
  }
  console.log('· trash ok (no longer in the active set)');

  console.log('✓ bookmark smoke passed');
}

void main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
