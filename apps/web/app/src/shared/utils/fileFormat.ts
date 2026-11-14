import type { Bookmark } from '../../api/schemas/bookmarks';

const EXTRACTABLE_MIMES = new Set([
  'application/pdf',
  'application/epub+zip',
  'text/markdown',
  'text/plain',
]);

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
  }
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;

  // Prefer RFC 5987 filename*=UTF-8''... over legacy filename="..."
  const starMatch = /filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\r\n]+)/i.exec(header);
  if (starMatch?.[1]) {
    const raw = starMatch[1].trim().replace(/^"(.*)"$/, '$1');
    try {
      const decoded = decodeURIComponent(raw).trim();
      if (decoded) return decoded;
    } catch {
      if (raw) return raw;
    }
  }

  const plainMatch = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;\r\n]+)/i.exec(header);
  const candidate = (plainMatch?.[1] ?? plainMatch?.[2] ?? '').trim();
  return candidate.length > 0 ? candidate : null;
}

export function isImageFileBookmark(bookmark: Bookmark): boolean {
  if (bookmark.storageKind !== 'file') return false;
  return (
    bookmark.contentType === 'image' ||
    Boolean(bookmark.fileMime && bookmark.fileMime.toLowerCase().startsWith('image/'))
  );
}

export function isExtractableTextFileBookmark(bookmark: Bookmark): boolean {
  if (bookmark.storageKind !== 'file') return false;
  const mime = bookmark.fileMime?.toLowerCase() ?? '';
  return EXTRACTABLE_MIMES.has(mime) || bookmark.cacheStatus === 'ready';
}

export function formatBookmarkFileMeta(bookmark: Bookmark): string | null {
  if (bookmark.storageKind !== 'file') return null;
  const parts: string[] = [];
  if (bookmark.fileName) parts.push(bookmark.fileName);
  if (bookmark.fileSize !== null) parts.push(formatFileSize(bookmark.fileSize));
  if (bookmark.fileMime) parts.push(bookmark.fileMime);
  return parts.length > 0 ? parts.join(' · ') : null;
}
