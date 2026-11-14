import { describe, expect, it } from 'bun:test';
import { CONTENT_TYPES } from '@api/database/entities/bookmark.entity';
import {
  DEFAULT_TEXT_SEARCH_FIELDS,
  SearchQueryParseError,
  SearchQueryParser,
  parseSearchQuery,
} from './search-query.parser';

function expectParseError(
  input: string,
  expected: {
    code: SearchQueryParseError['code'];
    position?: number;
    operator?: string;
    messageIncludes?: string;
  },
): SearchQueryParseError {
  try {
    parseSearchQuery(input);
  } catch (error) {
    expect(error).toBeInstanceOf(SearchQueryParseError);
    const err = error as SearchQueryParseError;
    expect(err.code).toBe(expected.code);
    if (expected.position !== undefined) {
      expect(err.position).toBe(expected.position);
    }
    if (expected.operator !== undefined) {
      expect(err.operator).toBe(expected.operator);
    }
    if (expected.messageIncludes !== undefined) {
      expect(err.message).toContain(expected.messageIncludes);
    }
    return err;
  }
  throw new Error(`Expected SearchQueryParseError for input: ${JSON.stringify(input)}`);
}

describe('SearchQueryParser', () => {
  it('returns empty AND query for empty or whitespace-only inputs', () => {
    expect(SearchQueryParser.parse('')).toEqual({ matchMode: 'AND', clauses: [] });
    expect(parseSearchQuery('   \t\n  ')).toEqual({ matchMode: 'AND', clauses: [] });
  });

  it('parses bare words, exact phrases, and escapes', () => {
    const parsed = parseSearchQuery('rust "async runtime" "say \\"hi\\\\there\\"" \\n');
    expect(parsed.matchMode).toBe('AND');
    expect(parsed.clauses).toEqual([
      {
        kind: 'text',
        value: 'rust',
        phrase: false,
        fields: DEFAULT_TEXT_SEARCH_FIELDS,
        negated: false,
        position: 0,
      },
      {
        kind: 'text',
        value: 'async runtime',
        phrase: true,
        fields: DEFAULT_TEXT_SEARCH_FIELDS,
        negated: false,
        position: 5,
      },
      {
        kind: 'text',
        value: 'say "hi\\there"',
        phrase: true,
        fields: DEFAULT_TEXT_SEARCH_FIELDS,
        negated: false,
        position: 21,
      },
      {
        kind: 'text',
        value: '\\n',
        phrase: false,
        fields: DEFAULT_TEXT_SEARCH_FIELDS,
        negated: false,
        position: 41,
      },
    ]);
  });

  it('preserves unknown backslash escapes inside quotes', () => {
    const parsed = parseSearchQuery('"foo\\bar"');
    expect(parsed.clauses).toEqual([
      {
        kind: 'text',
        value: 'foo\\bar',
        phrase: true,
        fields: DEFAULT_TEXT_SEARCH_FIELDS,
        negated: false,
        position: 0,
      },
    ]);
  });

  it('parses exclusions and keeps literal hyphens, flags, numbers with colons, and bare URLs as plain text', () => {
    const parsed = parseSearchQuery(
      '-spam -"click bait" - --flag 12:30 https://example.com/a:b -https://ads.example/x',
    );
    expect(parsed.clauses).toEqual([
      {
        kind: 'text',
        value: 'spam',
        phrase: false,
        fields: DEFAULT_TEXT_SEARCH_FIELDS,
        negated: true,
        position: 0,
      },
      {
        kind: 'text',
        value: 'click bait',
        phrase: true,
        fields: DEFAULT_TEXT_SEARCH_FIELDS,
        negated: true,
        position: 6,
      },
      {
        kind: 'text',
        value: '-',
        phrase: false,
        fields: DEFAULT_TEXT_SEARCH_FIELDS,
        negated: false,
        position: 20,
      },
      {
        kind: 'text',
        value: '--flag',
        phrase: false,
        fields: DEFAULT_TEXT_SEARCH_FIELDS,
        negated: false,
        position: 22,
      },
      {
        kind: 'text',
        value: '12:30',
        phrase: false,
        fields: DEFAULT_TEXT_SEARCH_FIELDS,
        negated: false,
        position: 29,
      },
      {
        kind: 'text',
        value: 'https://example.com/a:b',
        phrase: false,
        fields: DEFAULT_TEXT_SEARCH_FIELDS,
        negated: false,
        position: 35,
      },
      {
        kind: 'text',
        value: 'https://ads.example/x',
        phrase: false,
        fields: DEFAULT_TEXT_SEARCH_FIELDS,
        negated: true,
        position: 59,
      },
    ]);
  });

  it('parses #tag, -#tag, #"multi word tag", and -#"multi word tag"', () => {
    const parsed = parseSearchQuery(
      '#Rust -#legacy #"Web Dev" -#"read \\"later\\"" #"  trimmed  "',
    );
    expect(parsed.clauses).toEqual([
      { kind: 'tag', value: 'Rust', negated: false, position: 0 },
      { kind: 'tag', value: 'legacy', negated: true, position: 6 },
      { kind: 'tag', value: 'Web Dev', negated: false, position: 15 },
      { kind: 'tag', value: 'read "later"', negated: true, position: 26 },
      { kind: 'tag', value: 'trimmed', negated: false, position: 45 },
    ]);
  });

  it('parses match:OR and match:AND regardless of position and case', () => {
    expect(parseSearchQuery('match:OR').matchMode).toBe('OR');
    expect(parseSearchQuery('alpha match:or beta').matchMode).toBe('OR');
    expect(parseSearchQuery('alpha match:AND beta match:and').matchMode).toBe('AND');
    expect(parseSearchQuery('match:or alpha match:OR').clauses).toHaveLength(1);
  });

  it('rejects conflicting, negated, missing, or invalid match: directives with positions', () => {
    expectParseError('match:OR match:AND', {
      code: 'SYNTAX_ERROR',
      position: 9,
      operator: 'match',
    });
    expectParseError('-match:OR', {
      code: 'SYNTAX_ERROR',
      position: 0,
      operator: 'match',
    });
    expectParseError('match:XOR', {
      code: 'INVALID_VALUE',
      position: 6,
      operator: 'match',
    });
    expectParseError('match:', {
      code: 'MISSING_VALUE',
      position: 6,
      operator: 'match',
    });
  });

  it('parses field-scoped operators title:, excerpt:, note:, and link:', () => {
    const parsed = parseSearchQuery(
      'title:ArcDrop -title:"Old Title" Excerpt:"quick summary" -note:todo link:https://docs.rs/tokio',
    );
    expect(parsed.clauses).toEqual([
      {
        kind: 'field',
        field: 'title',
        value: 'ArcDrop',
        phrase: false,
        negated: false,
        position: 0,
      },
      {
        kind: 'field',
        field: 'title',
        value: 'Old Title',
        phrase: true,
        negated: true,
        position: 14,
      },
      {
        kind: 'field',
        field: 'excerpt',
        value: 'quick summary',
        phrase: true,
        negated: false,
        position: 33,
      },
      {
        kind: 'field',
        field: 'note',
        value: 'todo',
        phrase: false,
        negated: true,
        position: 57,
      },
      {
        kind: 'field',
        field: 'url',
        value: 'https://docs.rs/tokio',
        phrase: false,
        negated: false,
        position: 68,
      },
    ]);
  });

  it('parses type:, favorite:, notag:, and broken: including negations and case-insensitivity', () => {
    for (const type of CONTENT_TYPES) {
      const parsed = parseSearchQuery(`type:${type.toUpperCase()}`);
      expect(parsed.clauses).toEqual([{ kind: 'type', value: type, negated: false, position: 0 }]);
    }

    const combined = parseSearchQuery(
      '-type:video favorite:true -favorite:FALSE notag:true -notag:false broken:true -broken:FALSE',
    );
    expect(combined.clauses).toEqual([
      { kind: 'type', value: 'video', negated: true, position: 0 },
      { kind: 'favorite', value: true, negated: false, position: 12 },
      { kind: 'favorite', value: false, negated: true, position: 26 },
      { kind: 'notag', value: true, negated: false, position: 42 },
      { kind: 'notag', value: false, negated: true, position: 53 },
      { kind: 'broken', value: true, negated: false, position: 66 },
      { kind: 'broken', value: false, negated: true, position: 78 },
    ]);

    expectParseError('type:podcast', { code: 'INVALID_VALUE', position: 5, operator: 'type' });
    expectParseError('favorite:yes', {
      code: 'INVALID_VALUE',
      position: 9,
      operator: 'favorite',
    });
    expectParseError('notag:0', { code: 'INVALID_VALUE', position: 6, operator: 'notag' });
    expectParseError('broken:maybe', { code: 'INVALID_VALUE', position: 7, operator: 'broken' });
    expectParseError('broken:', { code: 'MISSING_VALUE', position: 7, operator: 'broken' });
  });

  it('parses created: and lastUpdate: with YYYY[-MM[-DD]] and <, >, <=, >= prefixes', () => {
    const parsed = parseSearchQuery(
      'created:2025 created:<2025-05 lastUpdate:>2024-02-29 created:<=2025-12 -lastUpdate:>=2026-01-15',
    );
    expect(parsed.clauses).toEqual([
      {
        kind: 'date',
        field: 'createdAt',
        comparator: 'eq',
        raw: '2025',
        start: new Date('2025-01-01T00:00:00.000Z'),
        endExclusive: new Date('2026-01-01T00:00:00.000Z'),
        negated: false,
        position: 0,
      },
      {
        kind: 'date',
        field: 'createdAt',
        comparator: 'lt',
        raw: '<2025-05',
        start: new Date('2025-05-01T00:00:00.000Z'),
        endExclusive: new Date('2025-06-01T00:00:00.000Z'),
        negated: false,
        position: 13,
      },
      {
        kind: 'date',
        field: 'updatedAt',
        comparator: 'gt',
        raw: '>2024-02-29',
        start: new Date('2024-02-29T00:00:00.000Z'),
        endExclusive: new Date('2024-03-01T00:00:00.000Z'),
        negated: false,
        position: 30,
      },
      {
        kind: 'date',
        field: 'createdAt',
        comparator: 'lte',
        raw: '<=2025-12',
        start: new Date('2025-12-01T00:00:00.000Z'),
        endExclusive: new Date('2026-01-01T00:00:00.000Z'),
        negated: false,
        position: 53,
      },
      {
        kind: 'date',
        field: 'updatedAt',
        comparator: 'gte',
        raw: '>=2026-01-15',
        start: new Date('2026-01-15T00:00:00.000Z'),
        endExclusive: new Date('2026-01-16T00:00:00.000Z'),
        negated: true,
        position: 71,
      },
    ]);
  });

  it('rejects invalid calendar dates and date formats', () => {
    expectParseError('created:2025-02-29', {
      code: 'INVALID_VALUE',
      position: 8,
      operator: 'created',
    });
    expectParseError('created:2025-04-31', {
      code: 'INVALID_VALUE',
      position: 8,
      operator: 'created',
    });
    expectParseError('created:2025-13', {
      code: 'INVALID_VALUE',
      position: 8,
      operator: 'created',
    });
    expectParseError('created:2025-00', {
      code: 'INVALID_VALUE',
      position: 8,
      operator: 'created',
    });
    expectParseError('lastUpdate:yesterday', {
      code: 'INVALID_VALUE',
      position: 11,
      operator: 'lastupdate',
    });
  });

  it('rejects reserved-but-inactive operators with "operator not available yet"', () => {
    for (const op of ['file:true', 'reminder:true', 'file:']) {
      const name = op.replace(/^-/, '').split(':')[0]!.toLowerCase();
      expectParseError(op, {
        code: 'RESERVED_OPERATOR',
        operator: name,
        messageIncludes: 'operator not available yet',
      });
    }
    expectParseError('rust file:pdf', {
      code: 'RESERVED_OPERATOR',
      position: 5,
      operator: 'file',
      messageIncludes: 'operator not available yet',
    });
  });

  it('rejects unknown operators and syntax errors with exact character positions', () => {
    expectParseError('author:alice', {
      code: 'UNKNOWN_OPERATOR',
      position: 0,
      operator: 'author',
      messageIncludes: 'position 0',
    });
    expectParseError('foo bar baz:qux', {
      code: 'UNKNOWN_OPERATOR',
      position: 8,
      operator: 'baz',
      messageIncludes: 'position 8',
    });
    expectParseError('localhost:3000', {
      code: 'UNKNOWN_OPERATOR',
      position: 0,
      operator: 'localhost',
    });
    expectParseError('rust #', {
      code: 'MISSING_VALUE',
      position: 5,
    });
    expectParseError('title: foo', {
      code: 'MISSING_VALUE',
      position: 6,
      operator: 'title',
    });
    expectParseError('rust "unterminated', {
      code: 'UNTERMINATED_QUOTE',
      position: 5,
    });
    expectParseError('"trailing\\', {
      code: 'UNTERMINATED_QUOTE',
      position: 0,
    });
    expectParseError('""', {
      code: 'INVALID_VALUE',
      position: 0,
    });
    expectParseError('#"   "', {
      code: 'INVALID_VALUE',
      position: 0,
    });
    expectParseError('title:""', {
      code: 'INVALID_VALUE',
      position: 6,
      operator: 'title',
    });
    expectParseError('"hello"world', {
      code: 'SYNTAX_ERROR',
      position: 7,
    });
    expectParseError('foo"bar', {
      code: 'SYNTAX_ERROR',
      position: 3,
    });
  });

  it('supports extending defaultTextFields without modifying parser logic (M17 hook)', () => {
    const extended = [...DEFAULT_TEXT_SEARCH_FIELDS, 'content', 'highlights'];
    const parsed = parseSearchQuery('rust "zero copy"', { defaultTextFields: extended });
    expect(parsed.clauses[0]).toMatchObject({ kind: 'text', fields: extended });
    expect(parsed.clauses[1]).toMatchObject({ kind: 'text', phrase: true, fields: extended });
  });
});
