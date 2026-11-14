import { describe, expect, it } from 'bun:test';
import {
  CreateBookmarkDto,
  ListBookmarksQueryDto,
  UpdateBookmarkDto,
} from '@api/bookmarks/bookmarks.dto';
import { ReorderCollectionsDto } from '@api/collections/collections.dto';
import { dtoSchema, mergedDtoSchema, toDtoInstances } from './dto-schema';

describe('dtoSchema (M7 parity foundation)', () => {
  it('derives CreateBookmarkDto: url required with its length bounds', () => {
    const schema = dtoSchema(CreateBookmarkDto);
    expect(schema['type']).toBe('object');
    const properties = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['url']?.['type']).toBe('string');
    expect(properties['url']?.['maxLength']).toBe(2048);
    expect(schema['required']).toEqual(['url']);
  });

  it('derives optional-update semantics: UpdateBookmarkDto has no required list', () => {
    const schema = dtoSchema(UpdateBookmarkDto);
    expect(schema['required']).toBeUndefined();
    const properties = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['title']?.['maxLength']).toBe(512);
  });

  it('derives the bookmark list query DTO with its enum + bounds', () => {
    const schema = dtoSchema(ListBookmarksQueryDto);
    const properties = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['sort']?.['enum']).toEqual(['updated', 'created', 'title', 'manual']);
    // pageSize > 200 is CLAMPED by the service (never refused) — so the
    // validation-derived schema carries the minimum but no maximum.
    expect(properties['pageSize']?.['minimum']).toBe(1);
    expect(properties['pageSize']?.['maximum']).toBeUndefined();
  });

  it('returns an independent copy — mutating the result never corrupts the cache', () => {
    const first = dtoSchema(CreateBookmarkDto);
    (first['properties'] as Record<string, unknown>)['url'] = 'tampered';
    const second = dtoSchema(CreateBookmarkDto);
    expect((second['properties'] as Record<string, Record<string, unknown>>)['url']).not.toBe(
      'tampered',
    );
  });
});

describe('mergedDtoSchema', () => {
  it('flattens param + body DTOs into one object schema with a union required list', () => {
    // bookmark-id + reorder payload share no property names; both requireds merge.
    const schema = mergedDtoSchema([CreateBookmarkDto, ReorderCollectionsDto]);
    const properties = schema['properties'] as Record<string, unknown>;
    expect(properties['url']).toBeDefined();
    expect(properties['items']).toBeDefined();
    expect(schema['required']).toEqual(['url', 'items']);
  });

  it('deduplicates required names when two parts share a property', () => {
    const schema = mergedDtoSchema([CreateBookmarkDto, UpdateBookmarkDto]);
    expect(schema['required']).toEqual(['url']);
  });
});

describe('toDtoInstances', () => {
  it('transforms plain arguments into DTO instances (decorators applied)', () => {
    const [query] = toDtoInstances([ListBookmarksQueryDto], { page: '3', search: 'docs' });
    expect((query as ListBookmarksQueryDto).page).toBe(3); // @Type(() => Number)
    expect((query as ListBookmarksQueryDto).search).toBe('docs');
  });

  it('maps one instance per DTO part from the same argument object', () => {
    const [param, body] = toDtoInstances([CreateBookmarkDto, UpdateBookmarkDto], {
      url: 'https://example.com',
      title: 'Example',
    });
    expect((param as CreateBookmarkDto).url).toBe('https://example.com');
    expect((body as UpdateBookmarkDto).title).toBe('Example');
  });

  it('treats missing arguments as an empty object', () => {
    const [dto] = toDtoInstances([UpdateBookmarkDto], undefined);
    expect(dto).toBeDefined();
  });
});
