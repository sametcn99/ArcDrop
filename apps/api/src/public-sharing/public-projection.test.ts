import { describe, expect, it } from 'bun:test';
import { toPublicBookmarkDto, type PublicBookmarkProjectionRow } from './public-sharing.service';

const ALLOWED_KEYS = [
  'contentType',
  'coverRef',
  'createdAt',
  'excerpt',
  'iconRef',
  'tags',
  'title',
  'url',
].sort();

describe('toPublicBookmarkDto', () => {
  it('emits ONLY the 8 allowlisted public fields even when private fields are present on the row', () => {
    const createdAt = new Date('2026-11-14T10:00:00.000Z');
    const rowWithPrivateExtras = {
      id: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
      storageKind: 'url',
      url: 'https://example.com/public',
      title: 'Public article',
      excerpt: 'Public excerpt',
      note: 'TOP SECRET PRIVATE NOTE',
      favorite: true,
      contentType: 'article',
      coverRef: 'cover123.jpg',
      iconRef: 'icon123.png',
      fileRef: null,
      fileName: null,
      fileMime: null,
      fileSize: null,
      highlights: [{ text: 'SECRET HIGHLIGHT', note: 'SECRET HL NOTE' }],
      reminderAt: new Date(),
      brokenReason: '404',
      cacheStatus: 'ready',
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    } as unknown as PublicBookmarkProjectionRow;

    const dto = toPublicBookmarkDto(rowWithPrivateExtras, ['reading', 'rust']);
    expect(Object.keys(dto).sort()).toEqual(ALLOWED_KEYS);
    expect(dto).toEqual({
      title: 'Public article',
      url: 'https://example.com/public',
      excerpt: 'Public excerpt',
      coverRef: 'cover123.jpg',
      iconRef: 'icon123.png',
      tags: ['reading', 'rust'],
      contentType: 'article',
      createdAt,
    });
    expect(JSON.stringify(dto)).not.toContain('TOP SECRET');
    expect(JSON.stringify(dto)).not.toContain('SECRET HIGHLIGHT');
  });

  it('exposes metadata only (url: null, no fileRef/fileName) for file-backed items', () => {
    const createdAt = new Date('2026-11-14T11:00:00.000Z');
    const fileRow = {
      id: '00000000-0000-4000-8000-000000000003',
      storageKind: 'file',
      url: 'https://should-never-leak.invalid/ignored',
      title: 'Quarterly Report',
      excerpt: 'Summary excerpt',
      coverRef: 'should-null.jpg',
      iconRef: 'should-null.png',
      fileRef: 'secret-file-ref.pdf',
      fileName: 'report.pdf',
      fileMime: 'application/pdf',
      fileSize: '12345',
      contentType: 'document',
      createdAt,
    } as unknown as PublicBookmarkProjectionRow;

    const dto = toPublicBookmarkDto(fileRow, ['docs']);
    expect(Object.keys(dto).sort()).toEqual(ALLOWED_KEYS);
    expect(dto).toEqual({
      title: 'Quarterly Report',
      url: null,
      excerpt: 'Summary excerpt',
      coverRef: null,
      iconRef: null,
      tags: ['docs'],
      contentType: 'document',
      createdAt,
    });
  });
});
