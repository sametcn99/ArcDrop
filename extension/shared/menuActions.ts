// Pure helpers behind the E4 context-menu and save-all-tabs flows — kept
// dependency-free so the background can use them and unit tests can pin the
// payload semantics (Raindrop-parity behaviors).

export interface TabItem {
  url: string;
  title: string;
}

export interface DedupedTabs {
  unique: TabItem[];
  /** Tabs dropped because another tab already had the same URL. */
  duplicatesRemoved: number;
}

/**
 * De-duplicates tabs by URL (first occurrence wins, order preserved) and
 * keeps only http(s) pages — internal/browser pages are not savable.
 */
export function dedupeTabs(tabs: TabItem[]): DedupedTabs {
  const seen = new Set<string>();
  const unique: TabItem[] = [];
  let duplicatesRemoved = 0;
  for (const tab of tabs) {
    if (!isHttpUrl(tab.url)) {
      continue;
    }
    if (seen.has(tab.url)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(tab.url);
    unique.push(tab);
  }
  return { unique, duplicatesRemoved };
}

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Title for a saved LINK. The contextMenus API does not expose the link's
 * text, so the selected text (when the link was selected) is the best
 * signal; otherwise the URL is summarized (host + last path segment).
 */
export function deriveLinkTitle(url: string, selectionText?: string | null): string {
  const selection = selectionText?.trim();
  if (selection) {
    return selection.slice(0, 512);
  }
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
    const last = segments[segments.length - 1];
    const label = last ? decodeURIComponent(last) : '';
    const cleaned = label
      .replace(/\.(html?|php|aspx?)$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim();
    return (parsed.hostname + (cleaned ? ` — ${cleaned}` : '')).slice(0, 512);
  } catch {
    return url.slice(0, 512);
  }
}

/**
 * Appends a saved selection to an existing bookmark's description.
 * Nothing to append (empty selection) → unchanged; fresh excerpt → just the
 * selection; existing excerpt → excerpt + separator + selection.
 */
export function appendSelectionToExcerpt(
  existing: string | null,
  selection: string,
): { excerpt: string; changed: boolean } {
  const trimmed = selection.trim();
  if (trimmed.length === 0) {
    return { excerpt: existing ?? '', changed: false };
  }
  const base = existing?.trim() ?? '';
  if (base.length === 0) {
    return { excerpt: trimmed, changed: true };
  }
  if (base.includes(trimmed)) {
    return { excerpt: base, changed: false };
  }
  return { excerpt: `${base}\n\n— ${trimmed}`, changed: true };
}

export type SaveOutcomeStatus = 'saved' | 'already-saved' | 'failed';

export interface SaveOutcome {
  status: SaveOutcomeStatus;
  url: string;
}

export interface SaveAllSummary {
  saved: number;
  /** Already-saved URLs (skipped, nothing written). */
  skipped: number;
  failed: number;
  /** Same-URL tabs dropped before any network call. */
  duplicatesRemoved: number;
}

export function summarizeSaveOutcomes(
  outcomes: SaveOutcome[],
  duplicatesRemoved: number,
): SaveAllSummary {
  let saved = 0;
  let skipped = 0;
  let failed = 0;
  for (const outcome of outcomes) {
    if (outcome.status === 'saved') saved += 1;
    else if (outcome.status === 'already-saved') skipped += 1;
    else failed += 1;
  }
  return { saved, skipped, failed, duplicatesRemoved };
}

/** Upload filename for a fetched image (extension derived from the mime). */
export function filenameFromImageUrl(url: string, mime: string): string {
  const MIME_EXTENSIONS: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
  };
  let basename = 'image';
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
    const last = segments[segments.length - 1];
    if (last) {
      basename = decodeURIComponent(last).replace(/[?#].*$/, '');
      if (basename.length === 0 || basename.length > 80) basename = 'image';
    }
  } catch {
    basename = 'image';
  }
  const extension = MIME_EXTENSIONS[mime] ?? 'png';
  return /\.[a-z0-9]{2,5}$/i.test(basename) ? basename : `${basename}.${extension}`;
}
