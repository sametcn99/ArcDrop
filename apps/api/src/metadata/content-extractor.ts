import { Readability } from '@mozilla/readability';
import { posix as posixPath } from 'node:path';
import { parseHTML } from 'linkedom';
import { extractText, getDocumentProxy } from 'unpdf';
import { readZipEntries } from '@api/portability/import/zip-reader';

/**
 * Cap for plain text persisted in PostgreSQL `bookmarks.archive_text` (FTS
 * source). PostgreSQL enforces a hard 1 MiB (1,048,575-byte) limit on a
 * single `tsvector` value; 500,000 characters keeps `search_vector` well
 * under that ceiling even with multi-byte UTF-8 words and weights, while the
 * full extracted text remains on disk in `content.txt`.
 */
export const MAX_ARCHIVE_TEXT_CHARS = 500_000;

export const PDF_CONTENT_TYPE = 'application/pdf';
export const EPUB_CONTENT_TYPE = 'application/epub+zip';
export const PLAIN_TEXT_CONTENT_TYPES = new Set(['text/plain', 'text/markdown', 'text/x-markdown']);

export interface ExtractedContent {
  title: string | null;
  excerpt: string | null;
  htmlContent: string;
  textContent: string;
  dbTextContent: string;
  truncated: boolean;
}

interface DomAttrLike {
  name: string;
  value: string;
}

interface DomNodeLike {
  nodeType: number;
  textContent: string | null;
  childNodes: ArrayLike<DomNodeLike>;
}

interface DomElementLike extends DomNodeLike {
  tagName: string;
  innerHTML: string;
  attributes: ArrayLike<DomAttrLike>;
  remove(): void;
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  querySelector(selector: string): DomElementLike | null;
  querySelectorAll(selector: string): ArrayLike<DomElementLike>;
}

interface DomDocumentLike {
  body: DomElementLike | null;
  querySelector(selector: string): DomElementLike | null;
  querySelectorAll(selector: string): ArrayLike<DomElementLike>;
}

const STRIP_TAGS_SELECTOR =
  'script, style, noscript, iframe, frame, frameset, object, embed, applet, form, input, button, textarea, select, base, meta, link, video, audio, source, track, canvas, svg';

const URI_ATTRS = new Set(['href', 'src', 'action', 'poster', 'cite']);

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const cleanOptionalText = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned;
};

const stripControlChars = (raw: string): string => {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) {
      out += raw[i]!;
    }
  }
  return out;
};

/** Truncates extracted plain text at a word boundary when exceeding `maxChars`. */
export function truncateForDb(text: string, maxChars: number = MAX_ARCHIVE_TEXT_CHARS): string {
  const normalized = text.replaceAll('\u0000', '').trim();
  if (normalized.length <= maxChars) return normalized;
  const slice = normalized.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  return lastSpace > maxChars * 0.8 ? slice.slice(0, lastSpace).trimEnd() : slice.trimEnd();
}

function isSafeUri(raw: string, baseUrl?: string): string | null {
  const cleaned = stripControlChars(raw).trim();
  if (cleaned === '') return null;
  if (cleaned.startsWith('#')) return cleaned;
  const lower = cleaned.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('data:text/html')
  ) {
    return null;
  }
  if (baseUrl) {
    try {
      const resolved = new URL(cleaned, baseUrl);
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
        return null;
      }
      return resolved.href;
    } catch {
      return null;
    }
  }
  return cleaned;
}

/**
 * Strips executable markup, event handlers, forms, and media embeds from an
 * HTML fragment so stored `content.html` is safe and readable.
 */
export function sanitizeExtractedHtml(rawHtml: string, baseUrl?: string): string {
  const { document } = parseHTML(
    `<!DOCTYPE html><html><body>${rawHtml}</body></html>`,
  ) as unknown as {
    document: DomDocumentLike;
  };
  const body = document.body;
  if (!body) return '';

  for (const el of Array.from(body.querySelectorAll(STRIP_TAGS_SELECTOR))) {
    el.remove();
  }

  for (const el of Array.from(body.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const nameLower = attr.name.toLowerCase();
      if (
        nameLower.startsWith('on') ||
        nameLower === 'srcdoc' ||
        nameLower === 'formaction' ||
        nameLower === 'xlink:href'
      ) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (URI_ATTRS.has(nameLower)) {
        const safe = isSafeUri(attr.value, baseUrl);
        if (safe === null) {
          el.removeAttribute(attr.name);
        } else {
          el.setAttribute(attr.name, safe);
        }
      }
    }
  }

  return body.innerHTML.trim();
}

/**
 * Walks DOM nodes preserving whitespace across block boundaries so adjacent
 * elements like `<p>boğazı</p><p>köprü</p>` never concatenate into `boğazıköprü`.
 */
export function extractBlockTextFromHtml(html: string): string {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`) as unknown as {
    document: DomDocumentLike;
  };
  const root = document.body;
  if (!root) return '';

  for (const el of Array.from(root.querySelectorAll(STRIP_TAGS_SELECTOR))) {
    el.remove();
  }

  const parts: string[] = [];

  const pushSpace = (): void => {
    if (parts.length === 0) return;
    const last = parts[parts.length - 1]!;
    if (!last.endsWith(' ') && !last.endsWith('\n')) {
      parts.push(' ');
    }
  };

  const pushNewline = (): void => {
    if (parts.length === 0) return;
    const last = parts[parts.length - 1]!;
    if (!last.endsWith('\n')) {
      parts.push('\n');
    }
  };

  const walk = (node: DomNodeLike): void => {
    // TEXT_NODE === 3
    if (node.nodeType === 3) {
      const text = (node.textContent ?? '').replace(/[\t\r\n]+/g, ' ');
      if (text.trim() !== '') {
        parts.push(text);
      } else if (text.includes(' ')) {
        pushSpace();
      }
      return;
    }

    // ELEMENT_NODE === 1
    if (node.nodeType !== 1) return;
    const el = node as DomElementLike;
    const tag = el.tagName.toLowerCase();

    if (tag === 'br') {
      pushNewline();
      return;
    }

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) {
      if (tag === 'td' || tag === 'th') {
        pushSpace();
      } else {
        pushNewline();
      }
    }

    for (const child of Array.from(node.childNodes)) {
      walk(child);
    }

    if (isBlock) {
      if (tag === 'td' || tag === 'th') {
        pushSpace();
      } else {
        pushNewline();
      }
    }
  };

  walk(root);

  return parts
    .join('')
    .replaceAll('\u0000', '')
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Extracts readable article HTML + block-aware plain text using
 * `@mozilla/readability` + `linkedom`, falling back to sanitized body content
 * on short pages where Readability returns null.
 */
export function extractHtmlContent(html: string, finalUrl: string): ExtractedContent | null {
  const { document } = parseHTML(html) as unknown as { document: DomDocumentLike };

  let title: string | null = null;
  let excerpt: string | null = null;
  let rawArticleHtml = '';

  try {
    const reader = new Readability(
      document as unknown as ConstructorParameters<typeof Readability>[0],
      {
        charThreshold: 25,
      },
    );
    const parsed = reader.parse();
    if (parsed) {
      title = cleanOptionalText(parsed.title);
      excerpt = cleanOptionalText(parsed.excerpt);
      rawArticleHtml = parsed.content ?? '';
    }
  } catch {
    // Fall back to sanitized body extraction below if Readability fails on malformed DOM.
  }

  if (rawArticleHtml.trim() === '') {
    const fallbackDoc = (parseHTML(html) as unknown as { document: DomDocumentLike }).document;
    rawArticleHtml = fallbackDoc.body?.innerHTML ?? html;
  }

  const sanitizedHtml = sanitizeExtractedHtml(rawArticleHtml, finalUrl);
  let textContent = extractBlockTextFromHtml(sanitizedHtml);

  if (textContent === '') {
    textContent = extractBlockTextFromHtml(html);
  }
  if (textContent === '') {
    return null;
  }

  const dbTextContent = truncateForDb(textContent);
  return {
    title,
    excerpt,
    htmlContent: sanitizedHtml !== '' ? sanitizedHtml : `<p>${escapeHtml(textContent)}</p>`,
    textContent,
    dbTextContent,
    truncated: dbTextContent.length < textContent.length,
  };
}

/**
 * Extracts text from a PDF buffer using `unpdf` (verified compatible with Bun
 * 1.4.2 and `bun build --target bun`). Always destroys the loading task.
 */
export async function extractPdfContent(bytes: Uint8Array): Promise<ExtractedContent | null> {
  if (bytes.byteLength === 0) return null;

  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  try {
    const { text } = await extractText(pdf, { mergePages: true });
    const normalized = text
      .replaceAll('\u0000', '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/ {2,}/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n');

    if (normalized === '') return null;

    const paragraphs = normalized
      .split('\n')
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('\n');

    const dbTextContent = truncateForDb(normalized);
    return {
      title: null,
      excerpt: null,
      htmlContent: `<article>${paragraphs}</article>`,
      textContent: normalized,
      dbTextContent,
      truncated: dbTextContent.length < normalized.length,
    };
  } finally {
    const destroyable = pdf as unknown as {
      loadingTask?: { destroy?: () => Promise<void> };
      destroy?: () => Promise<void>;
    };
    await (destroyable.loadingTask?.destroy?.() ?? destroyable.destroy?.())?.catch(() => {});
  }
}

/** Extracts plain-text / Markdown documents (shared foundation for `text/plain`, `text/markdown`, M18 uploads). */
export function extractPlainTextContent(rawText: string): ExtractedContent | null {
  const normalized = rawText.replaceAll('\u0000', '').replace(/\r\n?/g, '\n').trim();
  if (normalized === '') return null;

  const dbTextContent = truncateForDb(normalized);
  return {
    title: null,
    excerpt: null,
    htmlContent: `<pre>${escapeHtml(normalized)}</pre>`,
    textContent: normalized,
    dbTextContent,
    truncated: dbTextContent.length < normalized.length,
  };
}

/**
 * Extracts title, description, sanitized HTML chapters, and plain text from an
 * EPUB archive (`application/epub+zip`, plan M18 / D19). Reuses the in-tree
 * classic-ZIP reader + `linkedom` so zero new dependencies are introduced.
 *
 * Reading order comes from `META-INF/container.xml` → OPF `<manifest>` +
 * `<spine>` when available, falling back to lexicographically sorted
 * `.xhtml`/`.html` entries inside the archive.
 */
export function extractEpubContent(bytes: Uint8Array): ExtractedContent | null {
  if (bytes.byteLength === 0) return null;

  const entries = readZipEntries(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  const byName = new Map<string, Buffer>();
  for (const entry of entries) {
    byName.set(normalizeEpubPath(entry.name), entry.bytes);
  }

  let title: string | null = null;
  let excerpt: string | null = null;
  const chapterPaths: string[] = [];

  const containerBytes = byName.get('META-INF/container.xml');
  if (containerBytes) {
    const containerXml = containerBytes.toString('utf8');
    const opfPathMatch = /full-path\s*=\s*["']([^"']+)["']/i.exec(containerXml);
    const opfPath = opfPathMatch ? normalizeEpubPath(opfPathMatch[1]!) : null;
    const opfBytes = opfPath ? byName.get(opfPath) : undefined;
    if (opfPath && opfBytes) {
      const opfXml = opfBytes.toString('utf8');
      const opfDir = posixPath.dirname(opfPath);
      const doc = (parseHTML(opfXml) as unknown as { document: DomDocumentLike }).document;

      const titleEl = doc.querySelector('dc\\:title, title');
      title = cleanOptionalText(titleEl?.textContent);
      const descEl = doc.querySelector('dc\\:description, description');
      excerpt = cleanOptionalText(descEl?.textContent);

      const manifestById = new Map<string, { href: string; mediaType: string }>();
      for (const item of Array.from(doc.querySelectorAll('item'))) {
        const id = item.getAttribute('id');
        const href = item.getAttribute('href');
        const mediaType = (item.getAttribute('media-type') ?? '').toLowerCase();
        if (id && href) {
          manifestById.set(id, { href: decodeUriSafe(href), mediaType });
        }
      }

      for (const ref of Array.from(doc.querySelectorAll('itemref'))) {
        const idref = ref.getAttribute('idref');
        if (!idref) continue;
        const manifestItem = manifestById.get(idref);
        if (!manifestItem) continue;
        if (
          manifestItem.mediaType &&
          !manifestItem.mediaType.includes('html') &&
          !manifestItem.mediaType.includes('xml')
        ) {
          continue;
        }
        const resolved = normalizeEpubPath(
          opfDir === '.' ? manifestItem.href : posixPath.join(opfDir, manifestItem.href),
        );
        if (byName.has(resolved)) {
          chapterPaths.push(resolved);
        }
      }
    }
  }

  if (chapterPaths.length === 0) {
    for (const name of [...byName.keys()].sort()) {
      if (/\.(xhtml|html|htm)$/i.test(name)) {
        chapterPaths.push(name);
      }
    }
  }

  const htmlSections: string[] = [];
  const textSections: string[] = [];

  for (const chapterPath of chapterPaths) {
    const raw = byName.get(chapterPath)?.toString('utf8');
    if (!raw) continue;
    const sanitized = sanitizeExtractedHtml(raw);
    const text = extractBlockTextFromHtml(sanitized || raw);
    if (text !== '') {
      textSections.push(text);
      if (sanitized !== '') {
        htmlSections.push(`<section>${sanitized}</section>`);
      } else {
        htmlSections.push(`<section><p>${escapeHtml(text)}</p></section>`);
      }
    }
  }

  const combinedText = textSections.join('\n').trim();
  if (combinedText === '') return null;

  const dbTextContent = truncateForDb(combinedText);
  return {
    title,
    excerpt,
    htmlContent: `<article>${htmlSections.join('\n')}</article>`,
    textContent: combinedText,
    dbTextContent,
    truncated: dbTextContent.length < combinedText.length,
  };
}

function normalizeEpubPath(raw: string): string {
  return posixPath.normalize(raw.replaceAll('\\', '/')).replace(/^\/+/, '');
}

function decodeUriSafe(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Heuristically detects HTML paywalls and login walls so the archive pipeline
 * classifies them as `invalid-origin` instead of caching a sign-in prompt or
 * retrying endlessly.
 */
export function detectLoginOrPaywall(
  html: string,
  finalUrl: string,
  extractedText: string,
  initialUrl?: string,
): string | null {
  const { document } = parseHTML(html) as unknown as { document: DomDocumentLike };

  // Explicit structured paywall metadata (Schema.org / OpenGraph).
  for (const meta of Array.from(document.querySelectorAll('meta'))) {
    const name = (meta.getAttribute('name') ?? meta.getAttribute('property') ?? '').toLowerCase();
    const content = (meta.getAttribute('content') ?? '').toLowerCase();
    if (name === 'article:content_tier' && content === 'locked') {
      return 'paywall-detected';
    }
    if (name === 'isaccessibleforfree' && content === 'false') {
      return 'paywall-detected';
    }
  }

  const hasPasswordInput = document.querySelector('input[type="password"]') !== null;
  let redirectedToAuth = false;
  if (initialUrl && finalUrl !== initialUrl) {
    try {
      const initPath = new URL(initialUrl).pathname;
      const finalPath = new URL(finalUrl).pathname;
      if (
        finalPath !== initPath &&
        /\/(login|signin|sign-in|log-in|auth|sso|paywall|subscribe)\b/i.test(finalPath)
      ) {
        redirectedToAuth = true;
      }
    } catch {
      // ignore malformed URL comparison
    }
  }

  if (redirectedToAuth && (hasPasswordInput || extractedText.length < 1500)) {
    return 'login-wall-detected';
  }

  if (hasPasswordInput && extractedText.length < 1000) {
    return 'login-wall-detected';
  }

  const lowerText = extractedText.toLowerCase();
  if (
    extractedText.length < 800 &&
    (lowerText.includes('subscribers only') ||
      lowerText.includes('subscribe to read') ||
      lowerText.includes('sign in to continue') ||
      lowerText.includes('log in to continue'))
  ) {
    return 'paywall-detected';
  }

  return null;
}
