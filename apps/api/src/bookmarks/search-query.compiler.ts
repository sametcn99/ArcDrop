import { containsPattern } from './like-pattern';
import type { ParsedSearchQuery, SearchClause } from './search-query.parser';

export type TextFieldSqlBuilder = (paramName: string) => string;

/**
 * Field-model SQL registry (plan M11, M18). Nullable text columns use `COALESCE`
 * so SQL `NOT (...)` exclusions behave with standard two-valued boolean logic
 * when `title`, `excerpt`, `note`, or `url` (file bookmarks) is `NULL`.
 */
export const DEFAULT_TEXT_FIELD_BUILDERS: Readonly<Record<string, TextFieldSqlBuilder>> = {
  title: (param) => `COALESCE(b.title, '') ILIKE :${param}`,
  excerpt: (param) => `COALESCE(b.excerpt, '') ILIKE :${param}`,
  note: (param) => `COALESCE(b.note, '') ILIKE :${param}`,
  url: (param) => `COALESCE(b.url, '') ILIKE :${param}`,
  tags: (param) =>
    `EXISTS (SELECT 1 FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.bookmark_id = b.id AND t.name_lower ILIKE :${param})`,
};

/** Default M17 FTS field list used by `BookmarksService.list`. */
export const FTS_TEXT_SEARCH_FIELDS = [
  'title',
  'excerpt',
  'note',
  'content',
  'highlights',
  'url',
  'tags',
] as const;

export interface CompileSearchOptions {
  extraFieldBuilders?: Readonly<Record<string, TextFieldSqlBuilder>>;
  /**
   * Enables M17 PostgreSQL GIN-backed `tsvector` (`'simple'` config) hybrid
   * compilation for bare text/phrase clauses (`b.id IN (... UNION ...)`).
   * Scoped to the given `userId` inside every union subquery so PostgreSQL's
   * planner activates Bitmap Index Scans on both `IX_bookmarks_search_vector`
   * and `IX_highlights_search_vector`.
   */
  fts?: {
    userId: string;
  };
}

export interface CompiledSearchQuery {
  sql: string;
  params: Record<string, unknown>;
}

interface CompiledClause {
  negated: boolean;
  sql: string;
}

const CLEAN_PREFIX_WORD_RE = /^[\p{L}\p{N}]{2,}$/u;
const CLEAN_FTS_WORD_RE = /^[\p{L}\p{N}]{3,}$/u;
const CLEAN_FTS_PHRASE_RE = /^[\p{L}\p{N}\s]+$/u;
const HAS_WORD_CHAR_RE = /[\p{L}\p{N}]/u;

function isCompileSearchOptions(
  arg: Readonly<Record<string, TextFieldSqlBuilder>> | CompileSearchOptions,
): arg is CompileSearchOptions {
  if ('fts' in arg || 'extraFieldBuilders' in arg) {
    const ftsVal = (arg as CompileSearchOptions).fts;
    const extraVal = (arg as CompileSearchOptions).extraFieldBuilders;
    return (
      (ftsVal === undefined || typeof ftsVal === 'object') &&
      (extraVal === undefined || typeof extraVal === 'object')
    );
  }
  return false;
}

/**
 * Compiles a parsed search AST into a parameterized TypeORM QueryBuilder
 * `WHERE` predicate + parameter map. Returns `null` when the query has no
 * filter clauses (empty or `match:OR` alone).
 */
export function compileSearchQuery(
  parsed: ParsedSearchQuery,
  optionsOrBuilders: Readonly<Record<string, TextFieldSqlBuilder>> | CompileSearchOptions = {},
): CompiledSearchQuery | null {
  if (parsed.clauses.length === 0) return null;

  const opts: CompileSearchOptions = isCompileSearchOptions(optionsOrBuilders)
    ? optionsOrBuilders
    : { extraFieldBuilders: optionsOrBuilders };

  const builders: Record<string, TextFieldSqlBuilder> = {
    ...DEFAULT_TEXT_FIELD_BUILDERS,
    ...(opts.extraFieldBuilders ?? {}),
  };
  const params: Record<string, unknown> = {};
  let paramSeq = 0;
  const nextParam = (): string => `sq${paramSeq++}`;

  let ftsUserParam: string | undefined;
  if (opts.fts) {
    ftsUserParam = 'sqUserId';
    params[ftsUserParam] = opts.fts.userId;
  }

  const compiledClauses: CompiledClause[] = parsed.clauses.map((clause) =>
    compileClause(clause, builders, nextParam, params, ftsUserParam),
  );

  if (parsed.matchMode === 'AND') {
    const sql = compiledClauses.map((c) => `(${c.sql})`).join(' AND ');
    return { sql, params };
  }

  // match:OR — positive clauses form a disjunction; exclusions (`-word`,
  // `-#tag`, `-type:...`, etc.) remain mandatory ANDed filters so `-spam`
  // never matches every non-spam bookmark in the library.
  const positives = compiledClauses.filter((c) => !c.negated);
  const negatives = compiledClauses.filter((c) => c.negated);

  const parts: string[] = [];
  if (positives.length > 0) {
    parts.push(`(${positives.map((p) => `(${p.sql})`).join(' OR ')})`);
  }
  for (const neg of negatives) {
    parts.push(`(${neg.sql})`);
  }

  return { sql: parts.join(' AND '), params };
}

function buildTsQueryExpr(
  value: string,
  phrase: boolean,
  nextParam: () => string,
  params: Record<string, unknown>,
): { tsExpr: string; useIlikeFallback: boolean } {
  const trimmed = value.trim();
  const hasWord = HAS_WORD_CHAR_RE.test(trimmed);

  if (!hasWord) {
    return { tsExpr: 'FALSE', useIlikeFallback: true };
  }

  const tsParam = nextParam();
  params[tsParam] = trimmed;

  if (phrase) {
    const cleanPhrase =
      CLEAN_FTS_PHRASE_RE.test(trimmed) && trimmed.split(/\s+/).every((token) => token.length >= 3);
    return {
      tsExpr: `phraseto_tsquery('simple', :${tsParam})`,
      useIlikeFallback: !cleanPhrase,
    };
  }

  if (CLEAN_PREFIX_WORD_RE.test(trimmed)) {
    const prefixParam = nextParam();
    params[prefixParam] = `${trimmed}:*`;
    return {
      tsExpr: `(websearch_to_tsquery('simple', :${tsParam}) || to_tsquery('simple', :${prefixParam}))`,
      useIlikeFallback: !CLEAN_FTS_WORD_RE.test(trimmed),
    };
  }

  return {
    tsExpr: `websearch_to_tsquery('simple', :${tsParam})`,
    useIlikeFallback: true,
  };
}

function compileFtsTextClause(
  clause: Extract<SearchClause, { kind: 'text' }>,
  nextParam: () => string,
  params: Record<string, unknown>,
  ftsUserParam: string,
): CompiledClause {
  const fields = new Set(clause.fields);
  const likeParam = nextParam();
  params[likeParam] = containsPattern(clause.value);

  const { tsExpr, useIlikeFallback } = buildTsQueryExpr(
    clause.value,
    clause.phrase,
    nextParam,
    params,
  );

  const unionBranches: string[] = [];

  const wantsBookmarkFields =
    fields.has('title') || fields.has('excerpt') || fields.has('note') || fields.has('content');

  if (wantsBookmarkFields) {
    if (tsExpr !== 'FALSE') {
      unionBranches.push(
        `SELECT b2.id FROM bookmarks b2 WHERE b2.user_id = :${ftsUserParam} AND b2.search_vector @@ ${tsExpr}`,
      );
    }
    if (useIlikeFallback) {
      const likeChecks: string[] = [];
      if (fields.has('title')) likeChecks.push(`COALESCE(b2.title, '') ILIKE :${likeParam}`);
      if (fields.has('excerpt')) likeChecks.push(`COALESCE(b2.excerpt, '') ILIKE :${likeParam}`);
      if (fields.has('note')) likeChecks.push(`COALESCE(b2.note, '') ILIKE :${likeParam}`);
      if (fields.has('content'))
        likeChecks.push(`COALESCE(b2.archive_text, '') ILIKE :${likeParam}`);
      if (likeChecks.length > 0) {
        unionBranches.push(
          `SELECT b2.id FROM bookmarks b2 WHERE b2.user_id = :${ftsUserParam} AND (${likeChecks.join(' OR ')})`,
        );
      }
    }
  }

  if (fields.has('highlights')) {
    if (tsExpr !== 'FALSE') {
      unionBranches.push(
        `SELECT h.bookmark_id FROM highlights h WHERE h.user_id = :${ftsUserParam} AND h.search_vector @@ ${tsExpr}`,
      );
    }
    if (useIlikeFallback) {
      unionBranches.push(
        `SELECT h.bookmark_id FROM highlights h WHERE h.user_id = :${ftsUserParam} AND (h.text ILIKE :${likeParam} OR COALESCE(h.note, '') ILIKE :${likeParam})`,
      );
    }
  }

  if (fields.has('tags')) {
    unionBranches.push(
      `SELECT bt.bookmark_id FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id WHERE t.user_id = :${ftsUserParam} AND t.name_lower ILIKE :${likeParam}`,
    );
  }

  if (fields.has('url')) {
    unionBranches.push(
      `SELECT b3.id FROM bookmarks b3 WHERE b3.user_id = :${ftsUserParam} AND COALESCE(b3.url, '') ILIKE :${likeParam}`,
    );
  }

  const positiveSql = `b.id IN (${unionBranches.join(' UNION ')})`;
  return {
    negated: clause.negated,
    sql: clause.negated ? `NOT (${positiveSql})` : positiveSql,
  };
}

function compileClause(
  clause: SearchClause,
  builders: Readonly<Record<string, TextFieldSqlBuilder>>,
  nextParam: () => string,
  params: Record<string, unknown>,
  ftsUserParam?: string,
): CompiledClause {
  switch (clause.kind) {
    case 'text': {
      if (ftsUserParam !== undefined) {
        return compileFtsTextClause(clause, nextParam, params, ftsUserParam);
      }
      const param = nextParam();
      params[param] = containsPattern(clause.value);
      const predicates = clause.fields.map((field) => {
        const build = builders[field];
        if (!build) {
          throw new Error(`No search SQL builder registered for field "${field}"`);
        }
        return build(param);
      });
      const positiveSql = `(${predicates.join(' OR ')})`;
      return {
        negated: clause.negated,
        sql: clause.negated ? `NOT ${positiveSql}` : positiveSql,
      };
    }

    case 'field': {
      const param = nextParam();
      params[param] = containsPattern(clause.value);
      const build = builders[clause.field];
      if (!build) {
        throw new Error(`No search SQL builder registered for field "${clause.field}"`);
      }
      const positiveSql = build(param);
      return {
        negated: clause.negated,
        sql: clause.negated ? `NOT (${positiveSql})` : positiveSql,
      };
    }

    case 'tag': {
      const param = nextParam();
      params[param] = clause.value.toLowerCase();
      const existsSql =
        `EXISTS (SELECT 1 FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id ` +
        `WHERE bt.bookmark_id = b.id AND t.name_lower = :${param})`;
      return {
        negated: clause.negated,
        sql: clause.negated ? `NOT ${existsSql}` : existsSql,
      };
    }

    case 'type': {
      const param = nextParam();
      params[param] = clause.value;
      return {
        negated: clause.negated,
        sql: clause.negated ? `b.contentType != :${param}` : `b.contentType = :${param}`,
      };
    }

    case 'cacheStatus': {
      const param = nextParam();
      params[param] = clause.value;
      return {
        negated: clause.negated,
        sql: clause.negated ? `b.cacheStatus != :${param}` : `b.cacheStatus = :${param}`,
      };
    }

    case 'file': {
      const wantFile = clause.negated ? !clause.value : clause.value;
      return {
        negated: clause.negated,
        sql: wantFile ? `b.storageKind = 'file'` : `b.storageKind = 'url'`,
      };
    }

    case 'fileMime': {
      const param = nextParam();
      params[param] = [...clause.mimes];
      const positiveSql = `b.storageKind = 'file' AND COALESCE(b.fileMime, '') IN (:...${param})`;
      return {
        negated: clause.negated,
        sql: clause.negated ? `NOT (${positiveSql})` : positiveSql,
      };
    }

    case 'favorite': {
      const param = nextParam();
      params[param] = clause.negated ? !clause.value : clause.value;
      return {
        negated: clause.negated,
        sql: `b.favorite = :${param}`,
      };
    }

    case 'notag': {
      const wantNoTag = clause.negated ? !clause.value : clause.value;
      const existsSql = `EXISTS (SELECT 1 FROM bookmark_tags bt WHERE bt.bookmark_id = b.id)`;
      return {
        negated: clause.negated,
        sql: wantNoTag ? `NOT ${existsSql}` : existsSql,
      };
    }

    case 'broken': {
      const wantBroken = clause.negated ? !clause.value : clause.value;
      return {
        negated: clause.negated,
        sql: wantBroken ? 'b.brokenAt IS NOT NULL' : 'b.brokenAt IS NULL',
      };
    }

    case 'reminder': {
      const wantReminder = clause.negated ? !clause.value : clause.value;
      return {
        negated: clause.negated,
        sql: wantReminder ? 'b.reminderAt IS NOT NULL' : 'b.reminderAt IS NULL',
      };
    }

    case 'date': {
      const col = clause.field === 'createdAt' ? 'b.createdAt' : 'b.updatedAt';
      let positiveSql: string;
      switch (clause.comparator) {
        case 'eq': {
          const startParam = nextParam();
          const endParam = nextParam();
          params[startParam] = clause.start;
          params[endParam] = clause.endExclusive;
          positiveSql = `(${col} >= :${startParam} AND ${col} < :${endParam})`;
          break;
        }
        case 'lt': {
          const startParam = nextParam();
          params[startParam] = clause.start;
          positiveSql = `${col} < :${startParam}`;
          break;
        }
        case 'lte': {
          const endParam = nextParam();
          params[endParam] = clause.endExclusive;
          positiveSql = `${col} < :${endParam}`;
          break;
        }
        case 'gt': {
          const endParam = nextParam();
          params[endParam] = clause.endExclusive;
          positiveSql = `${col} >= :${endParam}`;
          break;
        }
        case 'gte': {
          const startParam = nextParam();
          params[startParam] = clause.start;
          positiveSql = `${col} >= :${startParam}`;
          break;
        }
      }
      return {
        negated: clause.negated,
        sql: clause.negated ? `NOT (${positiveSql})` : positiveSql,
      };
    }
  }
}
