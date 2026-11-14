import { describe, expect, it } from 'bun:test';
import { UnsupportedMediaTypeException } from '@nestjs/common';
import {
  defaultTitleFromFileName,
  extractFileExtension,
  resolveFileFilterMimes,
  resolveUploadFileType,
  sanitizeFileName,
  stripMimeParams,
} from './file-types';

describe('file-types allowlist & helpers (M18)', () => {
  it('resolves every allowlisted MIME type to its canonical extension and contentType', () => {
    const cases: Array<[string, string, string, string, boolean]> = [
      ['image/jpeg', 'image/jpeg', 'jpg', 'image', false],
      ['image/jpg', 'image/jpeg', 'jpg', 'image', false],
      ['image/gif', 'image/gif', 'gif', 'image', false],
      ['image/png', 'image/png', 'png', 'image', false],
      ['image/webp', 'image/webp', 'webp', 'image', false],
      ['image/heic', 'image/heic', 'heic', 'image', false],
      ['video/mp4', 'video/mp4', 'mp4', 'video', false],
      ['video/quicktime', 'video/quicktime', 'mov', 'video', false],
      ['video/x-ms-wmv', 'video/x-ms-wmv', 'wmv', 'video', false],
      ['video/webm', 'video/webm', 'webm', 'video', false],
      ['audio/mpeg', 'audio/mpeg', 'mp3', 'audio', false],
      ['audio/wav', 'audio/wav', 'wav', 'audio', false],
      ['audio/aiff', 'audio/aiff', 'aiff', 'audio', false],
      ['audio/flac', 'audio/flac', 'flac', 'audio', false],
      ['application/epub+zip', 'application/epub+zip', 'epub', 'book', true],
      ['application/pdf', 'application/pdf', 'pdf', 'document', true],
      ['text/markdown; charset=utf-8', 'text/markdown', 'md', 'document', true],
      ['text/plain; charset=utf-8', 'text/plain', 'txt', 'document', true],
    ];

    for (const [declared, canonicalMime, extension, contentType, extractable] of cases) {
      const resolved = resolveUploadFileType(declared, `sample.${extension}`);
      expect(resolved).toEqual({
        canonicalMime,
        extension,
        contentType: contentType as typeof resolved.contentType,
        extractable,
      });
    }
  });

  it('falls back to filename extension only for generic octet-stream MIMEs', () => {
    expect(resolveUploadFileType('application/octet-stream', 'notes.md')).toEqual({
      canonicalMime: 'text/markdown',
      extension: 'md',
      contentType: 'document',
      extractable: true,
    });
    expect(resolveUploadFileType(undefined, 'novel.epub')).toEqual({
      canonicalMime: 'application/epub+zip',
      extension: 'epub',
      contentType: 'book',
      extractable: true,
    });
    expect(resolveUploadFileType('binary/octet-stream', 'clip.MOV')).toEqual({
      canonicalMime: 'video/quicktime',
      extension: 'mov',
      contentType: 'video',
      extractable: false,
    });
  });

  it('rejects explicit disallowed MIMEs even when filename has an allowed extension', () => {
    expect(() => resolveUploadFileType('text/html', 'disguised.txt')).toThrow(
      UnsupportedMediaTypeException,
    );
    expect(() => resolveUploadFileType('image/svg+xml', 'vector.png')).toThrow(
      UnsupportedMediaTypeException,
    );
    expect(() => resolveUploadFileType('application/javascript', 'script.txt')).toThrow(
      UnsupportedMediaTypeException,
    );
    expect(() => resolveUploadFileType('application/octet-stream', 'binary.exe')).toThrow(
      UnsupportedMediaTypeException,
    );
  });

  it('resolves file:<token> search filter MIMEs across extensions, aliases, categories, and full MIMEs', () => {
    expect(resolveFileFilterMimes('pdf')).toEqual(['application/pdf']);
    expect(resolveFileFilterMimes('md')).toEqual(['text/markdown']);
    expect(resolveFileFilterMimes('markdown')).toEqual(['text/markdown']);
    expect(resolveFileFilterMimes('epub')).toEqual(['application/epub+zip']);
    expect(resolveFileFilterMimes('image')).toEqual([
      'image/jpeg',
      'image/gif',
      'image/png',
      'image/webp',
      'image/heic',
    ]);
    expect(resolveFileFilterMimes('audio/mp3')).toEqual(['audio/mpeg']);
    expect(resolveFileFilterMimes('exe')).toBeNull();
  });

  it('sanitizes filenames, strips MIME params, extracts extensions, and builds default titles', () => {
    expect(stripMimeParams('Text/Plain; charset=utf-8')).toBe('text/plain');
    expect(extractFileExtension('folder/sub\\archive.PDF')).toBe('pdf');
    expect(extractFileExtension('noext')).toBe('');
    expect(sanitizeFileName('../../evil\r\n"name";.pdf')).toBe('evilname.pdf');
    expect(sanitizeFileName('   ')).toBe('file');
    expect(defaultTitleFromFileName('quarterly-report.pdf')).toBe('quarterly-report');
    expect(defaultTitleFromFileName('.hidden')).toBe('.hidden');
  });
});
