import { UnsupportedMediaTypeException } from '@nestjs/common';
import type { ContentType } from '@api/database/entities/bookmark.entity';

export interface AllowedFileTypeSpec {
  canonicalMime: string;
  extension: string;
  contentType: ContentType;
  extractable: boolean;
}

/**
 * Canonical MIME allowlist for M18 file uploads (plan D19 / Raindrop parity G17):
 * - Images: jpeg, gif, png, webp, heic
 * - Video: mp4, mov, wmv, webm
 * - Audio: mp3, wav, aiff, flac
 * - Books: epub
 * - Documents: pdf, md, txt
 *
 * Executable/scripted formats (`text/html`, `image/svg+xml`, `application/javascript`,
 * etc.) are deliberately excluded.
 */
const MIME_SPECS: ReadonlyArray<{ aliases: readonly string[]; spec: AllowedFileTypeSpec }> = [
  // Images
  {
    aliases: ['image/jpeg', 'image/jpg'],
    spec: {
      canonicalMime: 'image/jpeg',
      extension: 'jpg',
      contentType: 'image',
      extractable: false,
    },
  },
  {
    aliases: ['image/gif'],
    spec: {
      canonicalMime: 'image/gif',
      extension: 'gif',
      contentType: 'image',
      extractable: false,
    },
  },
  {
    aliases: ['image/png'],
    spec: {
      canonicalMime: 'image/png',
      extension: 'png',
      contentType: 'image',
      extractable: false,
    },
  },
  {
    aliases: ['image/webp'],
    spec: {
      canonicalMime: 'image/webp',
      extension: 'webp',
      contentType: 'image',
      extractable: false,
    },
  },
  {
    aliases: ['image/heic', 'image/heif'],
    spec: {
      canonicalMime: 'image/heic',
      extension: 'heic',
      contentType: 'image',
      extractable: false,
    },
  },

  // Video
  {
    aliases: ['video/mp4'],
    spec: {
      canonicalMime: 'video/mp4',
      extension: 'mp4',
      contentType: 'video',
      extractable: false,
    },
  },
  {
    aliases: ['video/quicktime'],
    spec: {
      canonicalMime: 'video/quicktime',
      extension: 'mov',
      contentType: 'video',
      extractable: false,
    },
  },
  {
    aliases: ['video/x-ms-wmv'],
    spec: {
      canonicalMime: 'video/x-ms-wmv',
      extension: 'wmv',
      contentType: 'video',
      extractable: false,
    },
  },
  {
    aliases: ['video/webm'],
    spec: {
      canonicalMime: 'video/webm',
      extension: 'webm',
      contentType: 'video',
      extractable: false,
    },
  },

  // Audio
  {
    aliases: ['audio/mpeg', 'audio/mp3'],
    spec: {
      canonicalMime: 'audio/mpeg',
      extension: 'mp3',
      contentType: 'audio',
      extractable: false,
    },
  },
  {
    aliases: ['audio/wav', 'audio/wave', 'audio/x-wav', 'audio/vnd.wave'],
    spec: {
      canonicalMime: 'audio/wav',
      extension: 'wav',
      contentType: 'audio',
      extractable: false,
    },
  },
  {
    aliases: ['audio/aiff', 'audio/x-aiff'],
    spec: {
      canonicalMime: 'audio/aiff',
      extension: 'aiff',
      contentType: 'audio',
      extractable: false,
    },
  },
  {
    aliases: ['audio/flac', 'audio/x-flac'],
    spec: {
      canonicalMime: 'audio/flac',
      extension: 'flac',
      contentType: 'audio',
      extractable: false,
    },
  },

  // Books
  {
    aliases: ['application/epub+zip'],
    spec: {
      canonicalMime: 'application/epub+zip',
      extension: 'epub',
      contentType: 'book',
      extractable: true,
    },
  },

  // Text / Documents
  {
    aliases: ['application/pdf'],
    spec: {
      canonicalMime: 'application/pdf',
      extension: 'pdf',
      contentType: 'document',
      extractable: true,
    },
  },
  {
    aliases: ['text/markdown', 'text/x-markdown'],
    spec: {
      canonicalMime: 'text/markdown',
      extension: 'md',
      contentType: 'document',
      extractable: true,
    },
  },
  {
    aliases: ['text/plain'],
    spec: {
      canonicalMime: 'text/plain',
      extension: 'txt',
      contentType: 'document',
      extractable: true,
    },
  },
];

const BY_MIME = new Map<string, AllowedFileTypeSpec>();
const BY_EXTENSION = new Map<string, AllowedFileTypeSpec>();
const FILTER_TOKEN_TO_MIMES = new Map<string, readonly string[]>();

for (const entry of MIME_SPECS) {
  for (const alias of entry.aliases) {
    BY_MIME.set(alias, entry.spec);
    FILTER_TOKEN_TO_MIMES.set(alias, [entry.spec.canonicalMime]);
  }
  BY_EXTENSION.set(entry.spec.extension, entry.spec);
  FILTER_TOKEN_TO_MIMES.set(entry.spec.extension, [entry.spec.canonicalMime]);
}

BY_EXTENSION.set('jpeg', BY_EXTENSION.get('jpg')!);
BY_EXTENSION.set('heif', BY_EXTENSION.get('heic')!);
BY_EXTENSION.set('aif', BY_EXTENSION.get('aiff')!);
BY_EXTENSION.set('markdown', BY_EXTENSION.get('md')!);

FILTER_TOKEN_TO_MIMES.set('jpeg', ['image/jpeg']);
FILTER_TOKEN_TO_MIMES.set('jpg', ['image/jpeg']);
FILTER_TOKEN_TO_MIMES.set('heif', ['image/heic']);
FILTER_TOKEN_TO_MIMES.set('aif', ['audio/aiff']);
FILTER_TOKEN_TO_MIMES.set('markdown', ['text/markdown']);
FILTER_TOKEN_TO_MIMES.set('image', [
  'image/jpeg',
  'image/gif',
  'image/png',
  'image/webp',
  'image/heic',
]);
FILTER_TOKEN_TO_MIMES.set('video', [
  'video/mp4',
  'video/quicktime',
  'video/x-ms-wmv',
  'video/webm',
]);
FILTER_TOKEN_TO_MIMES.set('audio', ['audio/mpeg', 'audio/wav', 'audio/aiff', 'audio/flac']);
FILTER_TOKEN_TO_MIMES.set('book', ['application/epub+zip']);
FILTER_TOKEN_TO_MIMES.set('document', ['application/pdf', 'text/markdown', 'text/plain']);

const GENERIC_MIMES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

export function stripMimeParams(raw: string | undefined): string {
  if (!raw) return '';
  const semi = raw.indexOf(';');
  const base = semi === -1 ? raw : raw.slice(0, semi);
  return base.trim().toLowerCase();
}

export function extractFileExtension(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Validates and resolves an upload's declared MIME + filename into a canonical
 * allowlist entry. Extension fallback is applied ONLY when the client sends
 * an empty or generic `application/octet-stream` MIME type; explicit disallowed
 * MIMEs (e.g. `text/html`, `image/svg+xml`) are rejected immediately with 415.
 */
export function resolveUploadFileType(
  declaredMime: string | undefined,
  fileName: string,
): AllowedFileTypeSpec {
  const mime = stripMimeParams(declaredMime);
  const ext = extractFileExtension(fileName);

  if (!GENERIC_MIMES.has(mime)) {
    const spec = BY_MIME.get(mime);
    if (!spec) {
      throw new UnsupportedMediaTypeException(
        `Unsupported file media type "${mime}". Allowed: jpeg, gif, png, webp, heic, mp4, mov, wmv, webm, mp3, wav, aiff, flac, epub, pdf, md, txt`,
      );
    }
    return spec;
  }

  const fromExt = ext ? BY_EXTENSION.get(ext) : undefined;
  if (!fromExt) {
    throw new UnsupportedMediaTypeException(
      `Unsupported or unrecognized file type${ext ? ` ".${ext}"` : ''}. Allowed: jpeg, gif, png, webp, heic, mp4, mov, wmv, webm, mp3, wav, aiff, flac, epub, pdf, md, txt`,
    );
  }
  return fromExt;
}

/**
 * Resolves a `file:<token>` search filter token (e.g. `file:pdf`, `file:md`,
 * `file:image`, `file:application/pdf`) into canonical `file_mime` values,
 * returning `null` if unknown.
 */
export function resolveFileFilterMimes(token: string): readonly string[] | null {
  return FILTER_TOKEN_TO_MIMES.get(token.trim().toLowerCase()) ?? null;
}

/** Sanitizes a client-supplied filename for storage and Content-Disposition headers. */
export function sanitizeFileName(raw: string | undefined): string {
  const base = (raw ?? '').split(/[/\\]/).pop() ?? '';
  let cleaned = '';
  for (let i = 0; i < base.length; i += 1) {
    const code = base.charCodeAt(i);
    const ch = base[i]!;
    if (code < 0x20 || code === 0x7f || ch === '"' || ch === ';') continue;
    cleaned += ch;
  }
  cleaned = cleaned.trim();
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return 'file';
  return cleaned.length > 255 ? cleaned.slice(0, 255) : cleaned;
}

/** Title fallback when client omits title on upload: basename without extension. */
export function defaultTitleFromFileName(fileName: string): string {
  const safe = sanitizeFileName(fileName);
  const dot = safe.lastIndexOf('.');
  if (dot > 0) {
    const stem = safe.slice(0, dot).trim();
    if (stem !== '') return stem;
  }
  return safe;
}
