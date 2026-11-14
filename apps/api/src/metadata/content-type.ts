import type { ContentType } from '@api/database/entities/bookmark.entity';

export interface ContentTypeSignals {
  url: string;
  responseContentType?: string | null;
  ogType?: string | null;
}

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.svg',
  '.avif',
  '.bmp',
  '.ico',
  '.tiff',
  '.tif',
  '.heic',
  '.heif',
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.mkv',
  '.mov',
  '.avi',
  '.m4v',
  '.ogv',
  '.flv',
  '.wmv',
]);

const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.flac',
  '.ogg',
  '.oga',
  '.aac',
  '.m4a',
  '.opus',
  '.wma',
]);

const BOOK_EXTENSIONS = new Set([
  '.epub',
  '.mobi',
  '.azw',
  '.azw3',
  '.fb2',
  '.djvu',
  '.cbz',
  '.cbr',
]);

const DOCUMENT_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.odt',
  '.rtf',
  '.md',
  '.markdown',
  '.ppt',
  '.pptx',
  '.odp',
  '.xls',
  '.xlsx',
  '.ods',
  '.csv',
  '.tex',
]);

const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/rtf',
  'text/rtf',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/postscript',
]);

const BOOK_MIME_TYPES = new Set([
  'application/epub+zip',
  'application/x-mobipocket-ebook',
  'application/vnd.amazon.ebook',
]);

const VIDEO_HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'youtu.be',
  'vimeo.com',
  'player.vimeo.com',
  'twitch.tv',
  'clips.twitch.tv',
  'dailymotion.com',
  'tiktok.com',
]);

const AUDIO_HOSTS = new Set([
  'open.spotify.com',
  'podcasts.apple.com',
  'soundcloud.com',
  'music.youtube.com',
  'overcast.fm',
  'pocketcasts.com',
]);

const IMAGE_HOSTS = new Set([
  'imgur.com',
  'i.imgur.com',
  'giphy.com',
  'media.giphy.com',
  'unsplash.com',
  'images.unsplash.com',
  'flickr.com',
]);

const BOOK_HOSTS = new Set([
  'goodreads.com',
  'openlibrary.org',
  'standardebooks.org',
  'gutenberg.org',
]);

const ARTICLE_HOSTS = new Set(['medium.com', 'substack.com', 'dev.to']);

/**
 * Classifies a bookmark's content type using strict M10 precedence:
 * 1. Response `Content-Type` header (`image/*`, `video/*`, `audio/*`, epub/mobi → `book`,
 *    pdf/office/markdown/rtf → `document`; HTML falls through)
 * 2. HTML `<meta property="og:type">` (`article`/`blog`/`news`, `video*`, `music*`/`audio*`,
 *    `book*`, `image*`; `website` falls through)
 * 3. URL pathname file extension
 * 4. Known host patterns (subdomain-normalized, e.g. `youtube.com` → `video`, `*.substack.com` → `article`)
 * 5. Fallback: `'link'`
 */
export function classifyContentType(signals: ContentTypeSignals): ContentType {
  const fromMime = classifyMime(signals.responseContentType);
  if (fromMime !== null) return fromMime;

  const fromOg = classifyOgType(signals.ogType);
  if (fromOg !== null) return fromOg;

  const fromExtension = classifyUrlExtension(signals.url);
  if (fromExtension !== null) return fromExtension;

  const fromHost = classifyHost(signals.url);
  if (fromHost !== null) return fromHost;

  return 'link';
}

function classifyMime(raw: string | null | undefined): ContentType | null {
  if (!raw) return null;
  const mime = raw.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime === '') return null;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (BOOK_MIME_TYPES.has(mime)) return 'book';
  if (
    DOCUMENT_MIME_TYPES.has(mime) ||
    mime.startsWith('application/vnd.openxmlformats-officedocument.') ||
    mime.startsWith('application/vnd.oasis.opendocument.')
  ) {
    return 'document';
  }
  return null;
}

function classifyOgType(raw: string | null | undefined): ContentType | null {
  if (!raw) return null;
  const og = raw.trim().toLowerCase();
  if (og === '') return null;
  if (og === 'article' || og.startsWith('article:') || og === 'blog' || og === 'news') {
    return 'article';
  }
  if (og === 'video' || og.startsWith('video.') || og.startsWith('video:')) {
    return 'video';
  }
  if (og === 'audio' || og.startsWith('audio.') || og === 'music' || og.startsWith('music.')) {
    return 'audio';
  }
  if (og === 'book' || og.startsWith('book.') || og.startsWith('books.')) {
    return 'book';
  }
  if (og === 'image' || og.startsWith('image.')) {
    return 'image';
  }
  return null;
}

function classifyUrlExtension(rawUrl: string): ContentType | null {
  let pathname: string;
  try {
    pathname = new URL(rawUrl).pathname.toLowerCase();
  } catch {
    return null;
  }
  const lastSegment = pathname.split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  if (dot <= 0) return null; // no extension or dotfile only
  const ext = lastSegment.slice(dot);

  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (BOOK_EXTENSIONS.has(ext)) return 'book';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  return null;
}

function classifyHost(rawUrl: string): ContentType | null {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const bare = host.startsWith('www.') ? host.slice(4) : host;

  if (VIDEO_HOSTS.has(host) || VIDEO_HOSTS.has(bare)) return 'video';
  if (AUDIO_HOSTS.has(host) || AUDIO_HOSTS.has(bare) || bare.endsWith('.bandcamp.com')) {
    return 'audio';
  }
  if (bare === 'bandcamp.com') return 'audio';
  if (IMAGE_HOSTS.has(host) || IMAGE_HOSTS.has(bare)) return 'image';
  if (BOOK_HOSTS.has(host) || BOOK_HOSTS.has(bare)) return 'book';
  if (
    ARTICLE_HOSTS.has(host) ||
    ARTICLE_HOSTS.has(bare) ||
    bare.endsWith('.substack.com') ||
    bare.endsWith('.medium.com')
  ) {
    return 'article';
  }
  return null;
}
