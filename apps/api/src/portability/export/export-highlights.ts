/**
 * Per-bookmark highlights export (Raindrop parity G4, plan M8).
 *
 * M8 ships the CONTRACT only — ArcDrop has no highlight storage yet (the
 * Highlight entity + REST surface land in M10 per the plan), so the service
 * feeds these renderers an empty list today and the downloads are
 * well-formed but empty. When M10 lands, it hands real rows to the same
 * functions; the wire formats below do not change.
 *
 * Formats:
 * - `txt` — human-readable: each highlight is the quoted text, an optional
 *   `- note:` line, separated by blank lines;
 * - `csv` — one row per highlight: text,note,color,createdAt (RFC 4180).
 */
import { csvField } from './export-document';

export interface ExportHighlight {
  text: string;
  note: string | null;
  color: string | null;
  createdAt: string;
}

export const HIGHLIGHTS_CSV_HEADER = 'text,note,color,createdAt';

export function renderHighlightsTxt(highlights: readonly ExportHighlight[]): string {
  const blocks = highlights.map((highlight) => {
    const lines = [`"${highlight.text}"`];
    if (highlight.note !== null && highlight.note.length > 0) {
      lines.push(`- note: ${highlight.note}`);
    }
    return lines.join('\n');
  });
  return blocks.length > 0 ? blocks.join('\n\n') + '\n' : '';
}

export function renderHighlightsCsv(highlights: readonly ExportHighlight[]): string {
  const rows = highlights.map((highlight) =>
    [highlight.text, highlight.note ?? '', highlight.color ?? '', highlight.createdAt]
      .map(csvField)
      .join(','),
  );
  return [HIGHLIGHTS_CSV_HEADER, ...rows].join('\r\n') + '\r\n';
}
