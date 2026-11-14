import { describe, expect, it } from 'bun:test';
import { FTS_TEXT_SEARCH_FIELDS, compileSearchQuery } from './search-query.compiler';
import { DEFAULT_TEXT_SEARCH_FIELDS, parseSearchQuery } from './search-query.parser';

describe('compileSearchQuery', () => {
  it('returns null for empty queries or standalone match:OR', () => {
    expect(compileSearchQuery(parseSearchQuery(''))).toBeNull();
    expect(compileSearchQuery(parseSearchQuery('   '))).toBeNull();
    expect(compileSearchQuery(parseSearchQuery('match:OR'))).toBeNull();
  });

  it('compiles bare text terms with COALESCE on nullable columns and LIKE-escaped patterns', () => {
    const compiled = compileSearchQuery(parseSearchQuery('100%_test\\ok'));
    expect(compiled).not.toBeNull();
    expect(compiled!.params).toEqual({ sq0: '%100\\%\\_test\\\\ok%' });
    expect(compiled!.sql).toContain("COALESCE(b.title, '') ILIKE :sq0");
    expect(compiled!.sql).toContain("COALESCE(b.excerpt, '') ILIKE :sq0");
    expect(compiled!.sql).toContain("COALESCE(b.note, '') ILIKE :sq0");
    expect(compiled!.sql).toContain('b.url ILIKE :sq0');
    expect(compiled!.sql).toContain('t.name_lower ILIKE :sq0');
  });

  it('compiles negations safely using COALESCE so NULL fields do not drop results', () => {
    const compiled = compileSearchQuery(parseSearchQuery('-spam -title:draft'));
    expect(compiled).not.toBeNull();
    expect(compiled!.params).toEqual({ sq0: '%spam%', sq1: '%draft%' });
    expect(compiled!.sql).toContain("NOT (COALESCE(b.title, '') ILIKE :sq0");
    expect(compiled!.sql).toContain("NOT (COALESCE(b.title, '') ILIKE :sq1)");
  });

  it('ORs positive clauses in match:OR mode while keeping exclusions ANDed outside', () => {
    const compiled = compileSearchQuery(parseSearchQuery('match:OR rust #go -spam -type:video'));
    expect(compiled).not.toBeNull();
    expect(compiled!.sql).toMatch(
      /^\(\(.+\) OR \(.+\)\) AND \(NOT .+\) AND \(b\.contentType != :sq3\)$/,
    );
    expect(compiled!.params).toEqual({
      sq0: '%rust%',
      sq1: 'go',
      sq2: '%spam%',
      sq3: 'video',
    });
  });

  it('ANDs exclusions when match:OR has no positive clauses', () => {
    const compiled = compileSearchQuery(parseSearchQuery('match:OR -spam -#draft'));
    expect(compiled).not.toBeNull();
    expect(compiled!.sql).toContain(' AND ');
    expect(compiled!.sql).not.toContain(' OR (EXISTS');
  });

  it('compiles field, tag, type, cache.status, favorite, notag, broken, reminder, and date operators', () => {
    const compiled = compileSearchQuery(
      parseSearchQuery(
        'note:"key idea" link:docs.rs #Reading -favorite:true notag:false broken:true -broken:false reminder:true -reminder:false cache.status:ready -cache.status:failed created:2025-05 lastUpdate:<=2025-06-01',
      ),
    );
    expect(compiled).not.toBeNull();
    expect(compiled!.sql).toContain("COALESCE(b.note, '') ILIKE :sq0");
    expect(compiled!.sql).toContain('b.url ILIKE :sq1');
    expect(compiled!.sql).toContain('t.name_lower = :sq2');
    expect(compiled!.sql).toContain('b.favorite = :sq3');
    expect(compiled!.sql).toContain(
      'EXISTS (SELECT 1 FROM bookmark_tags bt WHERE bt.bookmark_id = b.id)',
    );
    expect(compiled!.sql).toContain('(b.brokenAt IS NOT NULL)');
    expect(compiled!.sql).toContain('(b.reminderAt IS NOT NULL)');
    expect(compiled!.sql).toContain('(b.cacheStatus = :sq4)');
    expect(compiled!.sql).toContain('(b.cacheStatus != :sq5)');
    expect(compiled!.sql).toContain('(b.createdAt >= :sq6 AND b.createdAt < :sq7)');
    expect(compiled!.sql).toContain('b.updatedAt < :sq8');
    expect(compiled!.params).toEqual({
      sq0: '%key idea%',
      sq1: '%docs.rs%',
      sq2: 'reading',
      sq3: false,
      sq4: 'ready',
      sq5: 'failed',
      sq6: new Date('2025-05-01T00:00:00.000Z'),
      sq7: new Date('2025-06-01T00:00:00.000Z'),
      sq8: new Date('2025-06-02T00:00:00.000Z'),
    });
  });

  it('compiles all date comparators (<, >, <=, >=) and negated dates', () => {
    const lt = compileSearchQuery(parseSearchQuery('created:<2025-05-10'))!;
    expect(lt.sql).toBe('(b.createdAt < :sq0)');
    expect(lt.params.sq0).toEqual(new Date('2025-05-10T00:00:00.000Z'));

    const gt = compileSearchQuery(parseSearchQuery('created:>2025-05-10'))!;
    expect(gt.sql).toBe('(b.createdAt >= :sq0)');
    expect(gt.params.sq0).toEqual(new Date('2025-05-11T00:00:00.000Z'));

    const gte = compileSearchQuery(parseSearchQuery('lastUpdate:>=2025-05'))!;
    expect(gte.sql).toBe('(b.updatedAt >= :sq0)');
    expect(gte.params.sq0).toEqual(new Date('2025-05-01T00:00:00.000Z'));

    const neg = compileSearchQuery(parseSearchQuery('-created:2025'))!;
    expect(neg.sql).toBe('(NOT ((b.createdAt >= :sq0 AND b.createdAt < :sq1)))');
  });

  it('supports extending registered text fields for M17 full-text search', () => {
    const parsed = parseSearchQuery('wasm', {
      defaultTextFields: [...DEFAULT_TEXT_SEARCH_FIELDS, 'content'],
    });
    const compiled = compileSearchQuery(parsed, {
      content: (param) => `COALESCE(b.content, '') ILIKE :${param}`,
    });
    expect(compiled!.sql).toContain("COALESCE(b.content, '') ILIKE :sq0");

    expect(() => compileSearchQuery(parsed)).toThrow(
      'No search SQL builder registered for field "content"',
    );
  });

  it('compiles M17 hybrid GIN FTS queries for bare words, prefix stems, exact phrases, short tokens, URLs, and negations', () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const parsed = parseSearchQuery('geliştirici "zero copy" go -spam', {
      defaultTextFields: FTS_TEXT_SEARCH_FIELDS,
    });
    const compiled = compileSearchQuery(parsed, { fts: { userId } })!;
    expect(compiled.params.sqUserId).toBe(userId);

    // Word >= 3 chars uses GIN tsvector + prefix :* across bookmarks & highlights, plus tags/url ILIKE (no archive_text ILIKE)
    expect(compiled.sql).toContain(
      "b2.search_vector @@ (websearch_to_tsquery('simple', :sq1) || to_tsquery('simple', :sq2))",
    );
    expect(compiled.sql).toContain(
      "h.search_vector @@ (websearch_to_tsquery('simple', :sq1) || to_tsquery('simple', :sq2))",
    );
    expect(compiled.params.sq1).toBe('geliştirici');
    expect(compiled.params.sq2).toBe('geliştirici:*');

    // Clean phrase uses phraseto_tsquery('simple', ...)
    expect(compiled.sql).toContain("b2.search_vector @@ phraseto_tsquery('simple', :sq4)");
    expect(compiled.sql).toContain("h.search_vector @@ phraseto_tsquery('simple', :sq4)");
    expect(compiled.params.sq4).toBe('zero copy');

    // Short 2-char token `go` retains ILIKE fallback + prefix tsquery
    expect(compiled.params.sq6).toBe('go');
    expect(compiled.params.sq7).toBe('go:*');
    expect(compiled.sql).toContain("COALESCE(b2.archive_text, '') ILIKE :sq5");
    expect(compiled.sql).toContain('h.text ILIKE :sq5');

    // Negation wraps the UNION subquery cleanly
    expect(compiled.sql).toContain('NOT (b.id IN (');
    expect(compiled.params.sq9).toBe('spam');
    expect(compiled.params.sq10).toBe('spam:*');
  });
});
