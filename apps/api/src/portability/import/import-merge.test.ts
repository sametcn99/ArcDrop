import { describe, expect, it } from 'bun:test';
import { pickFieldPatch } from './import-merge';

const dbRow = (
  overrides: Partial<{ title: string | null; note: string | null; updatedAt: Date }> = {},
) => ({
  title: 'Old title',
  excerpt: null as string | null,
  note: null as string | null,
  updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  ...overrides,
});

describe('pickFieldPatch (import merge semantics, ratified)', () => {
  it('fills empty database fields from the item regardless of age', () => {
    const patch = pickFieldPatch(dbRow(), {
      url: 'https://x.example',
      title: 'Fresh', // row title 'Old title' is non-empty and the item is older — kept
      note: 'note from the past',
      updatedAt: '2020-01-01T00:00:00.000Z', // OLDER than the row
    });
    expect(patch).toEqual({ note: 'note from the past' });
  });

  it('an older item never overwrites a non-empty field', () => {
    const patch = pickFieldPatch(dbRow({ note: 'kept' }), {
      url: 'https://x.example',
      note: 'newer text in file but older stamp',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(patch).toEqual({});
  });

  it('a newer item wins non-empty fields (last-write-wins, D4)', () => {
    const patch = pickFieldPatch(dbRow({ updatedAt: new Date('2025-01-01T00:00:00.000Z') }), {
      url: 'https://x.example',
      title: 'Renamed in export',
      updatedAt: '2025-06-01T00:00:00.000Z',
    });
    expect(patch).toEqual({ title: 'Renamed in export' });
  });

  it('items without timestamps only fill gaps (TXT/HTML/Netscape case)', () => {
    const patch = pickFieldPatch(dbRow({ note: 'kept' }), {
      url: 'https://x.example',
      title: 'Only title',
    });
    expect(patch).toEqual({});
  });

  it('empty/absent incoming data never clears anything', () => {
    const patch = pickFieldPatch(dbRow({ note: 'precious' }), {
      url: 'https://x.example',
      title: 'New title',
      note: null,
      updatedAt: '2030-01-01T00:00:00.000Z',
    });
    expect(patch).toEqual({ title: 'New title' });
  });

  it('identical values produce no patch (no no-op updates)', () => {
    const patch = pickFieldPatch(dbRow({ updatedAt: new Date('2025-01-01T00:00:00.000Z') }), {
      url: 'https://x.example',
      title: 'Old title',
      updatedAt: '2025-06-01T00:00:00.000Z',
    });
    expect(patch).toEqual({});
  });
});
