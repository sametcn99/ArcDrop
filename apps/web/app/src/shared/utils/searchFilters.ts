import {
  contentTypeSchema,
  type BookmarkContentType,
  type BookmarkListQuery,
  type BookmarkSort,
} from '../../api/schemas/bookmarks';

export type LibraryLayoutMode = 'list' | 'grid' | 'headlines' | 'moodboard';
export type LibraryScope = 'all' | 'favorites' | 'unassigned';

export const DEFAULT_LIBRARY_PAGE_SIZE = 24;

export interface BookmarkFilterState {
  search: string;
  type: BookmarkContentType | null;
  tags: string[];
  favorite: boolean;
  notag: boolean;
  broken: boolean;
  file: boolean;
  createdFrom: string;
  createdTo: string;
  matchOr: boolean;
}

export interface UrlViewState extends BookmarkFilterState {
  view: LibraryScope;
  sort: BookmarkSort;
  layout: LibraryLayoutMode;
}

export const EMPTY_FILTER_STATE: BookmarkFilterState = {
  search: '',
  type: null,
  tags: [],
  favorite: false,
  notag: false,
  broken: false,
  file: false,
  createdFrom: '',
  createdTo: '',
  matchOr: false,
};

const DATE_INPUT_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseScopeParam(raw: string | null): LibraryScope {
  if (raw === 'favorites' || raw === 'unassigned') return raw;
  return 'all';
}

export function parseSortParam(raw: string | null, allowManual = false): BookmarkSort {
  if (raw === 'created' || raw === 'title') return raw;
  if (allowManual && raw === 'manual') return 'manual';
  return 'updated';
}

export function parseLayoutParam(raw: string | null): LibraryLayoutMode {
  if (raw === 'grid' || raw === 'headlines' || raw === 'moodboard') return raw;
  return 'list';
}

export function parseContentTypeParam(raw: string | null): BookmarkContentType | null {
  if (!raw) return null;
  const parsed = contentTypeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseBooleanParam(raw: string | null): boolean {
  return raw === 'true' || raw === '1';
}

export function parseDateParam(raw: string | null): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!DATE_INPUT_RE.test(trimmed)) return '';
  const [yStr, mStr, dStr] = trimmed.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) {
    return '';
  }
  return trimmed;
}

export function normalizeTagsParam(rawTags: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawTags) {
    const trimmed = raw.trim().replace(/^#+/, '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(trimmed);
  }
  return deduped;
}

export function parseFilterState(params: URLSearchParams): BookmarkFilterState {
  const search = (params.get('search') ?? '').trim();
  const type = parseContentTypeParam(params.get('type'));
  const tags = normalizeTagsParam(params.getAll('tag'));
  const favorite = parseBooleanParam(params.get('favorite'));
  const notag = parseBooleanParam(params.get('notag'));
  const broken = parseBooleanParam(params.get('broken'));
  const file = parseBooleanParam(params.get('file'));
  const createdFrom = parseDateParam(params.get('createdFrom'));
  const createdTo = parseDateParam(params.get('createdTo'));
  const matchRaw = (params.get('match') ?? '').trim().toUpperCase();
  const matchOr = matchRaw === 'OR';

  return {
    search,
    type,
    tags,
    favorite,
    notag,
    broken,
    file,
    createdFrom,
    createdTo,
    matchOr,
  };
}

export function parseUrlState(
  params: URLSearchParams,
  options: { allowManualSort?: boolean } = {},
): UrlViewState {
  const allowManual = options.allowManualSort ?? false;
  return {
    view: parseScopeParam(params.get('view')),
    sort: parseSortParam(params.get('sort'), allowManual),
    layout: parseLayoutParam(params.get('layout')),
    ...parseFilterState(params),
  };
}

export function serializeFilterParams(
  filters: BookmarkFilterState,
  target: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  target.delete('search');
  target.delete('type');
  target.delete('tag');
  target.delete('favorite');
  target.delete('notag');
  target.delete('broken');
  target.delete('file');
  target.delete('createdFrom');
  target.delete('createdTo');
  target.delete('match');

  const trimmedSearch = filters.search.trim();
  if (trimmedSearch !== '') {
    target.set('search', trimmedSearch);
  }
  if (filters.type !== null) {
    target.set('type', filters.type);
  }
  for (const tag of normalizeTagsParam(filters.tags)) {
    target.append('tag', tag);
  }
  if (filters.favorite) {
    target.set('favorite', 'true');
  }
  if (filters.notag) {
    target.set('notag', 'true');
  }
  if (filters.broken) {
    target.set('broken', 'true');
  }
  if (filters.file) {
    target.set('file', 'true');
  }
  if (filters.createdFrom !== '') {
    target.set('createdFrom', filters.createdFrom);
  }
  if (filters.createdTo !== '') {
    target.set('createdTo', filters.createdTo);
  }
  if (filters.matchOr) {
    target.set('match', 'OR');
  }

  return target;
}

export function serializeFilterKey(filters: BookmarkFilterState): string {
  return serializeFilterParams(filters).toString();
}

export function hasActiveFilters(filters: BookmarkFilterState): boolean {
  return (
    filters.type !== null ||
    filters.tags.length > 0 ||
    filters.favorite ||
    filters.notag ||
    filters.broken ||
    filters.file ||
    filters.createdFrom !== '' ||
    filters.createdTo !== '' ||
    filters.matchOr
  );
}

export function hasActiveSearchOrFilters(filters: BookmarkFilterState): boolean {
  return filters.search.trim() !== '' || hasActiveFilters(filters);
}

export function formatSearchTagToken(tagName: string): string {
  const trimmed = tagName.trim();
  if (/[\s"\\]/.test(trimmed)) {
    const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `#"${escaped}"`;
  }
  return `#${trimmed}`;
}

export function buildBookmarkApiQuery(options: {
  scope?: LibraryScope;
  collectionId?: string;
  sort: BookmarkSort;
  filters: BookmarkFilterState;
  page: number;
  pageSize?: number;
}): BookmarkListQuery {
  const {
    scope = 'all',
    collectionId,
    sort,
    filters,
    page,
    pageSize = DEFAULT_LIBRARY_PAGE_SIZE,
  } = options;

  const query: BookmarkListQuery = {
    page,
    pageSize,
    sort,
    trashed: false,
  };

  if (collectionId) {
    query.collectionId = collectionId;
  } else if (scope === 'favorites') {
    query.favorite = true;
  } else if (scope === 'unassigned') {
    query.unassignedOnly = true;
  }

  if (filters.type !== null) {
    query.type = filters.type;
  }
  if (filters.favorite) {
    query.favorite = true;
  }
  if (filters.broken) {
    query.broken = true;
  }
  if (filters.file) {
    query.file = true;
  }

  const normalizedTags = normalizeTagsParam(filters.tags);
  const searchTokens: string[] = [];
  const trimmedSearch = filters.search.trim();

  if (filters.matchOr && !/\bmatch:(?:OR|AND)\b/i.test(trimmedSearch)) {
    searchTokens.push('match:OR');
  }
  if (trimmedSearch !== '') {
    searchTokens.push(trimmedSearch);
  }

  if (normalizedTags.length === 1) {
    query.tag = normalizedTags[0];
  } else if (normalizedTags.length > 1) {
    for (const tag of normalizedTags) {
      searchTokens.push(formatSearchTagToken(tag));
    }
  }

  if (filters.notag) {
    searchTokens.push('notag:true');
  }
  if (filters.createdFrom !== '') {
    searchTokens.push(`created:>=${filters.createdFrom}`);
  }
  if (filters.createdTo !== '') {
    searchTokens.push(`created:<=${filters.createdTo}`);
  }

  if (searchTokens.length > 0) {
    query.search = searchTokens.join(' ');
  }

  return query;
}
