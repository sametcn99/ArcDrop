import { containsPattern } from './like-pattern';
import type { ParsedSearchQuery, SearchClause } from './search-query.parser';

export type TextFieldSqlBuilder = (paramName: string) => string;

/**
 * Field-model SQL registry (plan M11). Nullable text columns use `COALESCE`
 * so SQL `NOT (...)` exclusions behave with standard two-valued boolean logic
 * when `title`, `excerpt`, or `note` is `NULL`.
 *
 * M17 adds `content` (and/or `highlights`) here without changing the parser.
 */
export const DEFAULT_TEXT_FIELD_BUILDERS: Readonly<Record<string, TextFieldSqlBuilder>> = {
  title: (param) => `COALESCE(b.title, '') ILIKE :${param}`,
  excerpt: (param) => `COALESCE(b.excerpt, '') ILIKE :${param}`,
  note: (param) => `COALESCE(b.note, '') ILIKE :${param}`,
  url: (param) => `b.url ILIKE :${param}`,
  tags: (param) =>
    `EXISTS (SELECT 1 FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.bookmark_id = b.id AND t.name_lower ILIKE :${param})`,
};

export interface CompiledSearchQuery {
  sql: string;
  params: Record<string, unknown>;
}

interface CompiledClause {
  negated: boolean;
  sql: string;
}

/**
 * Compiles a parsed search AST into a parameterized TypeORM QueryBuilder
 * `WHERE` predicate + parameter map. Returns `null` when the query has no
 * filter clauses (empty or `match:OR` alone).
 */
export function compileSearchQuery(
  parsed: ParsedSearchQuery,
  extraFieldBuilders: Readonly<Record<string, TextFieldSqlBuilder>> = {},
): CompiledSearchQuery | null {
  if (parsed.clauses.length === 0) return null;

  const builders: Record<string, TextFieldSqlBuilder> = {
    ...DEFAULT_TEXT_FIELD_BUILDERS,
    ...extraFieldBuilders,
  };
  const params: Record<string, unknown> = {};
  let paramSeq = 0;
  const nextParam = (): string => `sq${paramSeq++}`;

  const compiledClauses: CompiledClause[] = parsed.clauses.map((clause) =>
    compileClause(clause, builders, nextParam, params),
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

function compileClause(
  clause: SearchClause,
  builders: Readonly<Record<string, TextFieldSqlBuilder>>,
  nextParam: () => string,
  params: Record<string, unknown>,
): CompiledClause {
  switch (clause.kind) {
    case 'text': {
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
