import { CONTENT_TYPES, type ContentType } from '@api/database/entities/bookmark.entity';

/**
 * Default bookmark fields matched by unqualified words and `"exact phrases"`
 * (plan M11 / D19). M17 extends this list (e.g. adding `content` /
 * `highlights`) without rewriting the parser.
 */
export const DEFAULT_TEXT_SEARCH_FIELDS = ['title', 'excerpt', 'note', 'url', 'tags'] as const;
export type SearchTextField = (typeof DEFAULT_TEXT_SEARCH_FIELDS)[number];

/** Field-scoped operator names (`link:` aliases the bookmark `url`). */
export const FIELD_SCOPE_MAP = {
  title: 'title',
  excerpt: 'excerpt',
  note: 'note',
  link: 'url',
} as const;
export type FieldScopeOperator = keyof typeof FIELD_SCOPE_MAP;
export type ScopedBookmarkField = (typeof FIELD_SCOPE_MAP)[FieldScopeOperator];

/**
 * Operators reserved for upcoming Wave-2 milestones. Parsed explicitly so
 * clients receive an honest 400 ("operator not available yet") rather than
 * silent fallback to plain-text matching.
 */
export const RESERVED_OPERATORS = {
  broken: 'M12',
  reminder: 'M14',
  file: 'M18',
} as const;
export type ReservedOperatorName = keyof typeof RESERVED_OPERATORS;

export type SearchMatchMode = 'AND' | 'OR';
export type DateComparator = 'eq' | 'lt' | 'gt' | 'lte' | 'gte';

export type SearchClause =
  | {
      kind: 'text';
      value: string;
      phrase: boolean;
      fields: readonly string[];
      negated: boolean;
      position: number;
    }
  | {
      kind: 'field';
      field: ScopedBookmarkField;
      value: string;
      phrase: boolean;
      negated: boolean;
      position: number;
    }
  | {
      kind: 'tag';
      value: string;
      negated: boolean;
      position: number;
    }
  | {
      kind: 'type';
      value: ContentType;
      negated: boolean;
      position: number;
    }
  | {
      kind: 'favorite';
      value: boolean;
      negated: boolean;
      position: number;
    }
  | {
      kind: 'notag';
      value: boolean;
      negated: boolean;
      position: number;
    }
  | {
      kind: 'date';
      field: 'createdAt' | 'updatedAt';
      comparator: DateComparator;
      raw: string;
      start: Date;
      endExclusive: Date;
      negated: boolean;
      position: number;
    };

export interface ParsedSearchQuery {
  matchMode: SearchMatchMode;
  clauses: readonly SearchClause[];
}

export interface SearchParserOptions {
  /** Override the field set targeted by bare words and `"exact phrases"`. */
  defaultTextFields?: readonly string[];
  /** Reserved operators explicitly enabled (for M12/M14/M18 integration). */
  enabledReservedOperators?: readonly ReservedOperatorName[];
}

export type SearchQueryParseErrorCode =
  | 'UNKNOWN_OPERATOR'
  | 'RESERVED_OPERATOR'
  | 'INVALID_VALUE'
  | 'MISSING_VALUE'
  | 'UNTERMINATED_QUOTE'
  | 'SYNTAX_ERROR';

export class SearchQueryParseError extends Error {
  constructor(
    public readonly code: SearchQueryParseErrorCode,
    public readonly position: number,
    message: string,
    public readonly operator?: string,
  ) {
    super(message);
    this.name = 'SearchQueryParseError';
  }
}

const CONTENT_TYPE_SET: ReadonlySet<string> = new Set(CONTENT_TYPES);
const OPERATOR_PREFIX_RE = /^([a-zA-Z][a-zA-Z0-9_]*):/;
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const DATE_VALUE_RE = /^(<=|>=|<|>)?(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

const isWhitespace = (ch: string): boolean => /\s/.test(ch);

/**
 * Pure parser for ArcDrop's Raindrop-compatible search operator grammar
 * (plan M11, D19, parity G9).
 *
 * Grammar summary:
 * - Bare `word` or `"exact phrase"` (supports `\"` and `\\` escapes)
 * - Exclusion `-` prefix on terms, phrases, `#tag`, and predicate operators
 * - `#tag` and `#"multi word tag"` (and `-#tag` / `-#"multi word tag"`)
 * - `match:OR` / `match:AND` (default `AND`)
 * - Field-scoped: `title:`, `excerpt:`, `note:`, `link:`
 * - Metadata: `type:<contentType>`, `favorite:true|false`, `notag:true|false`
 * - Dates: `created:` and `lastUpdate:` with `[<|>|<=|>=]YYYY[-MM[-DD]]`
 * - Reserved (fail with 400 until implemented): `broken:`, `file:`, `reminder:`
 */
export function parseSearchQuery(
  input: string,
  options: SearchParserOptions = {},
): ParsedSearchQuery {
  const defaultFields = options.defaultTextFields ?? DEFAULT_TEXT_SEARCH_FIELDS;
  const enabledReserved = new Set<ReservedOperatorName>(options.enabledReservedOperators ?? []);

  const clauses: SearchClause[] = [];
  let matchMode: SearchMatchMode | undefined;
  let i = 0;
  const len = input.length;

  const skipWhitespace = (): void => {
    while (i < len && isWhitespace(input[i]!)) {
      i += 1;
    }
  };

  const readQuoted = (quotePos: number): string => {
    // Advance past opening quote.
    i += 1;
    let out = '';
    while (i < len) {
      const ch = input[i]!;
      if (ch === '\\') {
        if (i + 1 >= len) {
          throw new SearchQueryParseError(
            'UNTERMINATED_QUOTE',
            quotePos,
            `Unterminated quoted string at position ${quotePos}`,
          );
        }
        const next = input[i + 1]!;
        if (next === '"' || next === '\\') {
          out += next;
        } else {
          out += `\\${next}`;
        }
        i += 2;
        continue;
      }
      if (ch === '"') {
        i += 1;
        if (i < len && !isWhitespace(input[i]!)) {
          throw new SearchQueryParseError(
            'SYNTAX_ERROR',
            i,
            `Unexpected character "${input[i]}" after closing quote at position ${i}`,
          );
        }
        return out;
      }
      out += ch;
      i += 1;
    }
    throw new SearchQueryParseError(
      'UNTERMINATED_QUOTE',
      quotePos,
      `Unterminated quoted string at position ${quotePos}`,
    );
  };

  const readUnquoted = (): string => {
    let out = '';
    while (i < len && !isWhitespace(input[i]!)) {
      const ch = input[i]!;
      if (ch === '"') {
        throw new SearchQueryParseError(
          'SYNTAX_ERROR',
          i,
          `Unexpected quote inside unquoted term at position ${i}`,
        );
      }
      out += ch;
      i += 1;
    }
    return out;
  };

  const readValue = (
    valuePos: number,
    operatorName?: string,
  ): { value: string; phrase: boolean } => {
    if (i >= len || isWhitespace(input[i]!)) {
      const what = operatorName ? `operator "${operatorName}"` : 'tag';
      throw new SearchQueryParseError(
        'MISSING_VALUE',
        valuePos,
        `Missing value for ${what} at position ${valuePos}`,
        operatorName,
      );
    }
    if (input[i] === '"') {
      const quotePos = i;
      const value = readQuoted(quotePos);
      if (value.length === 0) {
        const what = operatorName ? `operator "${operatorName}"` : 'phrase';
        throw new SearchQueryParseError(
          'INVALID_VALUE',
          quotePos,
          `Empty quoted ${what} at position ${quotePos}`,
          operatorName,
        );
      }
      return { value, phrase: true };
    }
    return { value: readUnquoted(), phrase: false };
  };

  while (i < len) {
    skipWhitespace();
    if (i >= len) break;

    const termPos = i;
    let negated = false;

    // Single `-` followed by non-whitespace and non-`-` negates the term/operator.
    // Lone `-` or `--flag` stays a literal text token so titles like `A - B` or
    // CLI flags like `--verbose` remain searchable.
    if (input[i] === '-') {
      if (i + 1 >= len || isWhitespace(input[i + 1]!) || input[i + 1] === '-') {
        const value = readUnquoted();
        clauses.push({
          kind: 'text',
          value,
          phrase: false,
          fields: defaultFields,
          negated: false,
          position: termPos,
        });
        continue;
      }
      negated = true;
      i += 1;
    }

    // Quoted phrase: "..." or -"..."
    if (input[i] === '"') {
      const quotePos = i;
      const value = readQuoted(quotePos);
      if (value.length === 0) {
        throw new SearchQueryParseError(
          'INVALID_VALUE',
          quotePos,
          `Empty quoted phrase at position ${quotePos}`,
        );
      }
      clauses.push({
        kind: 'text',
        value,
        phrase: true,
        fields: defaultFields,
        negated,
        position: termPos,
      });
      continue;
    }

    // Tag operator: #tag, #"multi word tag", -#tag, -#"multi word tag"
    if (input[i] === '#') {
      const hashPos = i;
      i += 1;
      const { value } = readValue(hashPos);
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        throw new SearchQueryParseError(
          'INVALID_VALUE',
          hashPos,
          `Empty tag name at position ${hashPos}`,
        );
      }
      clauses.push({
        kind: 'tag',
        value: trimmed,
        negated,
        position: termPos,
      });
      continue;
    }

    // Bare URL literal (e.g. `https://example.com` or `-https://spam.example`)
    // stays a plain text term rather than being mistaken for an `https:` operator.
    const rest = input.slice(i);
    if (URL_SCHEME_RE.test(rest)) {
      const value = readUnquoted();
      clauses.push({
        kind: 'text',
        value,
        phrase: false,
        fields: defaultFields,
        negated,
        position: termPos,
      });
      continue;
    }

    // Operator syntax: `<name>:<value>`
    const opMatch = OPERATOR_PREFIX_RE.exec(rest);
    if (opMatch) {
      const rawName = opMatch[1]!;
      const opKey = rawName.toLowerCase();
      const opPos = i;
      i += rawName.length + 1; // skip `name:`
      const valuePos = i;

      if (opKey in RESERVED_OPERATORS && !enabledReserved.has(opKey as ReservedOperatorName)) {
        const milestone = RESERVED_OPERATORS[opKey as ReservedOperatorName];
        throw new SearchQueryParseError(
          'RESERVED_OPERATOR',
          opPos,
          `Search operator "${rawName}" at position ${opPos} (planned for ${milestone}): operator not available yet`,
          opKey,
        );
      }

      if (opKey === 'match') {
        if (negated) {
          throw new SearchQueryParseError(
            'SYNTAX_ERROR',
            termPos,
            `Operator "match" cannot be negated at position ${termPos}`,
            'match',
          );
        }
        const { value } = readValue(valuePos, rawName);
        const upper = value.toUpperCase();
        if (upper !== 'OR' && upper !== 'AND') {
          throw new SearchQueryParseError(
            'INVALID_VALUE',
            valuePos,
            `Invalid value "${value}" for operator "match" at position ${valuePos}; expected OR or AND`,
            'match',
          );
        }
        if (matchMode !== undefined && matchMode !== upper) {
          throw new SearchQueryParseError(
            'SYNTAX_ERROR',
            opPos,
            `Conflicting "match:${upper}" directive at position ${opPos} (already set to ${matchMode})`,
            'match',
          );
        }
        matchMode = upper;
        continue;
      }

      if (opKey === 'title' || opKey === 'excerpt' || opKey === 'note' || opKey === 'link') {
        const { value, phrase } = readValue(valuePos, rawName);
        clauses.push({
          kind: 'field',
          field: FIELD_SCOPE_MAP[opKey],
          value,
          phrase,
          negated,
          position: termPos,
        });
        continue;
      }

      if (opKey === 'type') {
        const { value } = readValue(valuePos, rawName);
        const lower = value.toLowerCase();
        if (!CONTENT_TYPE_SET.has(lower)) {
          throw new SearchQueryParseError(
            'INVALID_VALUE',
            valuePos,
            `Invalid value "${value}" for operator "type" at position ${valuePos}; expected one of: ${CONTENT_TYPES.join(', ')}`,
            'type',
          );
        }
        clauses.push({
          kind: 'type',
          value: lower as ContentType,
          negated,
          position: termPos,
        });
        continue;
      }

      if (opKey === 'favorite') {
        const boolVal = parseBooleanValue(readValue(valuePos, rawName).value, rawName, valuePos);
        clauses.push({
          kind: 'favorite',
          value: boolVal,
          negated,
          position: termPos,
        });
        continue;
      }

      if (opKey === 'notag') {
        const boolVal = parseBooleanValue(readValue(valuePos, rawName).value, rawName, valuePos);
        clauses.push({
          kind: 'notag',
          value: boolVal,
          negated,
          position: termPos,
        });
        continue;
      }

      if (opKey === 'created' || opKey === 'lastupdate') {
        const { value } = readValue(valuePos, rawName);
        const parsedDate = parseDateConstraint(value, rawName, valuePos);
        clauses.push({
          kind: 'date',
          field: opKey === 'created' ? 'createdAt' : 'updatedAt',
          comparator: parsedDate.comparator,
          raw: value,
          start: parsedDate.start,
          endExclusive: parsedDate.endExclusive,
          negated,
          position: termPos,
        });
        continue;
      }

      // Unknown operator — fail honestly with position rather than silently falling back.
      throw new SearchQueryParseError(
        'UNKNOWN_OPERATOR',
        opPos,
        `Unknown search operator "${rawName}" at position ${opPos}`,
        opKey,
      );
    }

    // Plain word
    const value = readUnquoted();
    clauses.push({
      kind: 'text',
      value,
      phrase: false,
      fields: defaultFields,
      negated,
      position: termPos,
    });
  }

  return {
    matchMode: matchMode ?? 'AND',
    clauses,
  };
}

export const SearchQueryParser = {
  parse: parseSearchQuery,
} as const;

function parseBooleanValue(value: string, operatorName: string, position: number): boolean {
  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  throw new SearchQueryParseError(
    'INVALID_VALUE',
    position,
    `Invalid value "${value}" for operator "${operatorName}" at position ${position}; expected true or false`,
    operatorName.toLowerCase(),
  );
}

function parseDateConstraint(
  value: string,
  operatorName: string,
  position: number,
): { comparator: DateComparator; start: Date; endExclusive: Date } {
  const match = DATE_VALUE_RE.exec(value);
  if (!match) {
    throw new SearchQueryParseError(
      'INVALID_VALUE',
      position,
      `Invalid date "${value}" for operator "${operatorName}" at position ${position}; expected [<|>|<=|>=]YYYY[-MM[-DD]]`,
      operatorName.toLowerCase(),
    );
  }

  const prefix = match[1];
  const comparator: DateComparator =
    prefix === '<'
      ? 'lt'
      : prefix === '>'
        ? 'gt'
        : prefix === '<='
          ? 'lte'
          : prefix === '>='
            ? 'gte'
            : 'eq';

  const year = Number(match[2]);
  const monthRaw = match[3];
  const dayRaw = match[4];

  if (monthRaw === undefined) {
    const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const endExclusive = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
    return { comparator, start, endExclusive };
  }

  const month = Number(monthRaw);
  if (month < 1 || month > 12) {
    throw new SearchQueryParseError(
      'INVALID_VALUE',
      position,
      `Invalid month "${monthRaw}" in date "${value}" for operator "${operatorName}" at position ${position}`,
      operatorName.toLowerCase(),
    );
  }

  if (dayRaw === undefined) {
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const endExclusive = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    return { comparator, start, endExclusive };
  }

  const day = Number(dayRaw);
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (
    start.getUTCFullYear() !== year ||
    start.getUTCMonth() !== month - 1 ||
    start.getUTCDate() !== day
  ) {
    throw new SearchQueryParseError(
      'INVALID_VALUE',
      position,
      `Invalid calendar date "${value}" for operator "${operatorName}" at position ${position}`,
      operatorName.toLowerCase(),
    );
  }
  const endExclusive = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
  return { comparator, start, endExclusive };
}
