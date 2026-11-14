import { emptyParsedImport, type ParsedImport } from './import-model';
import { validateBookmarkItem } from './normalize';

/**
 * TXT import (Raindrop parity G3): one URL per line. Blank lines are
 * ignored silently (trailing newlines must not inflate `skipped`); a
 * non-blank line becomes a bookmark candidate whose URL the upsert engine
 * validates — structurally broken lines land in `errors` with their line
 * number. TXT carries no titles/tags/collections (lossy by definition).
 */
export function parseTxtImport(text: string): ParsedImport {
  const result = emptyParsedImport();
  const lines = text.split(/\r\n|\n|\r/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.length === 0) continue;
    const validated = validateBookmarkItem({ url: line }, `line ${i + 1}`, result.errors);
    if (validated) result.bookmarks.push(validated);
  }
  return result;
}
