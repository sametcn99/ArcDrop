import { describe, expect, it } from 'vitest';
import {
  buildCollectionViewKey,
  buildLibraryViewKey,
  parseViewKey,
} from '../../stores/libraryStore';
import {
  buildBookmarkApiQuery,
  EMPTY_FILTER_STATE,
  formatSearchTagToken,
  hasActiveFilters,
  hasActiveSearchOrFilters,
  parseScopeParam,
  parseUrlState,
  serializeFilterKey,
  serializeFilterParams,
  type BookmarkFilterState,
} from './searchFilters';

describe('searchFilters utilities', () => {
  it('parses URL state including view, sort, layout, and all M11 filter parameters', () => {
    const params = new URLSearchParams(
      'view=favorites&sort=title&layout=moodboard&search=%23arch+-spam&type=video&tag=sync&tag=%23Sync&tag=design&favorite=1&notag=true&broken=true&file=true&createdFrom=2026-01-01&createdTo=2026-12-31&match=or',
    );

    const parsed = parseUrlState(params);
    expect(parsed).toEqual({
      view: 'favorites',
      sort: 'title',
      layout: 'moodboard',
      search: '#arch -spam',
      type: 'video',
      tags: ['sync', 'design'],
      favorite: true,
      notag: true,
      broken: true,
      file: true,
      createdFrom: '2026-01-01',
      createdTo: '2026-12-31',
      updatedFrom: '',
      updatedTo: '',
      cacheStatus: null,
      domain: '',
      matchOr: true,
    });

    const manualParams = new URLSearchParams('sort=manual');
    expect(parseUrlState(manualParams, { allowManualSort: false }).sort).toBe('updated');
    expect(parseUrlState(manualParams, { allowManualSort: true }).sort).toBe('manual');
  });

  it('ignores malformed filter values and formats quoted tag tokens safely', () => {
    const params = new URLSearchParams(
      'type=unknown&createdFrom=not-a-date&createdTo=2026-99-99&layout=invalid&sort=manual',
    );
    const parsed = parseUrlState(params);
    expect(parsed.type).toBeNull();
    expect(parsed.createdFrom).toBe('');
    expect(parsed.createdTo).toBe('');
    expect(parsed.layout).toBe('list');
    expect(parsed.sort).toBe('updated');

    expect(formatSearchTagToken('architecture')).toBe('#architecture');
    expect(formatSearchTagToken('reading list')).toBe('#"reading list"');
    expect(formatSearchTagToken('a"b\\c')).toBe('#"a\\"b\\\\c"');
  });

  it('round-trips filters through serializeFilterParams while preserving non-filter params', () => {
    const filters: BookmarkFilterState = {
      search: '"exact phrase" -draft',
      type: 'article',
      tags: ['architecture', 'reading list'],
      favorite: true,
      notag: true,
      broken: true,
      file: true,
      createdFrom: '2026-02-01',
      createdTo: '2026-02-28',
      updatedFrom: '',
      updatedTo: '',
      cacheStatus: null,
      domain: '',
      matchOr: true,
    };

    const target = new URLSearchParams('sort=created&layout=grid&type=video');
    serializeFilterParams(filters, target);

    expect(target.get('sort')).toBe('created');
    expect(target.get('layout')).toBe('grid');
    expect(parseUrlState(target)).toEqual({
      view: 'all',
      sort: 'created',
      layout: 'grid',
      ...filters,
    });
    expect(hasActiveFilters(filters)).toBe(true);
    expect(hasActiveSearchOrFilters(EMPTY_FILTER_STATE)).toBe(false);
    expect(serializeFilterKey(EMPTY_FILTER_STATE)).toBe('');
  });

  it('maps single tag to REST param and composes multiple tags, dates, notag, and match:OR into API search query', () => {
    const singleTagQuery = buildBookmarkApiQuery({
      scope: 'unassigned',
      sort: 'title',
      filters: {
        ...EMPTY_FILTER_STATE,
        tags: ['architecture'],
        type: 'video',
        broken: true,
        file: true,
      },
      page: 2,
      pageSize: 50,
    });

    expect(singleTagQuery).toEqual({
      page: 2,
      pageSize: 50,
      sort: 'title',
      trashed: false,
      unassignedOnly: true,
      type: 'video',
      broken: true,
      file: true,
      tag: 'architecture',
    });

    const composedQuery = buildBookmarkApiQuery({
      collectionId: 'col-9',
      sort: 'updated',
      filters: {
        search: '-spam type:article',
        type: 'video',
        tags: ['architecture', 'reading list'],
        favorite: true,
        notag: true,
        broken: false,
        file: false,
        createdFrom: '2026-01-01',
        createdTo: '2026-06-30',
        matchOr: true,
      },
      page: 1,
    });

    expect(composedQuery).toEqual({
      page: 1,
      pageSize: 24,
      sort: 'updated',
      trashed: false,
      collectionId: 'col-9',
      type: 'video',
      favorite: true,
      search:
        'match:OR -spam type:article #architecture #"reading list" notag:true created:>=2026-01-01 created:<=2026-06-30',
    });

    // Does not duplicate match:OR if the user already wrote match:OR in the search string.
    const explicitMatchQuery = buildBookmarkApiQuery({
      sort: 'updated',
      filters: {
        ...EMPTY_FILTER_STATE,
        search: 'alpha match:OR beta',
        matchOr: true,
      },
      page: 1,
    });
    expect(explicitMatchQuery.search).toBe('alpha match:OR beta');
  });

  it('builds and parses filtered library and collection view keys cleanly', () => {
    const filters: BookmarkFilterState = {
      ...EMPTY_FILTER_STATE,
      search: 'guide',
      tags: ['sync'],
      favorite: true,
    };

    const libKey = buildLibraryViewKey('favorites', 'title', filters);
    expect(parseViewKey(libKey)).toEqual({
      kind: 'library',
      scope: 'favorites',
      sort: 'title',
      filters,
      hasFilters: true,
    });

    const colKey = buildCollectionViewKey('col-42', 'manual', filters);
    expect(parseViewKey(colKey)).toEqual({
      kind: 'collection',
      collectionId: 'col-42',
      sort: 'manual',
      filters,
      hasFilters: true,
    });
  });

  it('supports the reminders scope in URL params, view keys, and API queries', () => {
    expect(parseScopeParam('reminders')).toBe('reminders');
    expect(parseScopeParam('nonsense')).toBe('all');

    const remindersKey = buildLibraryViewKey('reminders', 'updated', EMPTY_FILTER_STATE);
    expect(parseViewKey(remindersKey)).toEqual({
      kind: 'library',
      scope: 'reminders',
      sort: 'updated',
      filters: EMPTY_FILTER_STATE,
      hasFilters: false,
    });

    const remindersQuery = buildBookmarkApiQuery({
      scope: 'reminders',
      sort: 'updated',
      filters: EMPTY_FILTER_STATE,
      page: 1,
    });
    expect(remindersQuery).toEqual({
      page: 1,
      pageSize: 24,
      sort: 'updated',
      trashed: false,
      reminder: true,
    });
  });

  it('parses cacheStatus, domain, and updated-range params into the API query', () => {
    const params = new URLSearchParams(
      'cacheStatus=ready&domain=github.com&updatedFrom=2026-02-01&updatedTo=2026-03-01',
    );
    const parsed = parseUrlState(params);
    expect(parsed.cacheStatus).toBe('ready');
    expect(parsed.domain).toBe('github.com');
    expect(parsed.updatedFrom).toBe('2026-02-01');
    expect(parsed.updatedTo).toBe('2026-03-01');

    // Unknown cache statuses are dropped, and domains are trimmed.
    const invalid = parseUrlState(
      new URLSearchParams('cacheStatus=bogus&domain=%20example.com%20'),
    );
    expect(invalid.cacheStatus).toBeNull();
    expect(invalid.domain).toBe('example.com');

    const query = buildBookmarkApiQuery({
      scope: 'all',
      sort: 'updated',
      filters: {
        ...EMPTY_FILTER_STATE,
        cacheStatus: 'failed',
        domain: 'github.com',
        updatedFrom: '2026-02-01',
        updatedTo: '2026-03-01',
      },
      page: 1,
    });
    expect(query.cacheStatus).toBe('failed');
    expect(query.domain).toBe('github.com');
    expect(query.search).toBe('lastUpdate:>=2026-02-01 lastUpdate:<=2026-03-01');

    // Round-trips through the URL serializer.
    const target = serializeFilterParams({
      ...EMPTY_FILTER_STATE,
      cacheStatus: 'failed',
      domain: 'github.com',
      updatedFrom: '2026-02-01',
    });
    expect(target.get('cacheStatus')).toBe('failed');
    expect(target.get('domain')).toBe('github.com');
    expect(target.get('updatedFrom')).toBe('2026-02-01');
    expect(hasActiveFilters(EMPTY_FILTER_STATE)).toBe(false);
    expect(
      hasActiveFilters({ ...EMPTY_FILTER_STATE, cacheStatus: null, domain: '', updatedFrom: '' }),
    ).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTER_STATE, cacheStatus: 'ready' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTER_STATE, domain: 'a.dev' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTER_STATE, updatedTo: '2026-01-01' })).toBe(true);
  });
});
