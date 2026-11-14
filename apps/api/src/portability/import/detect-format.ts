import { emptyParsedImport, type ParsedImport } from './import-model';
import { isArcDropJson, parseArcDropDocument } from './parse-arcdrop';
import { isRaindropJson, parseRaindropDocument } from './parse-raindrop';
import { parseCsvImport } from './parse-csv';
import { parseEnexImport } from './parse-enex';
import { parseNetscapeImport } from './parse-netscape';
import { parseTxtImport } from './parse-txt';

/** Import source kinds — the REST path detects them, the MCP path takes them explicitly. */
export const IMPORT_FORMATS = ['json', 'csv', 'html', 'txt', 'enex', 'zip'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export function isImportFormat(value: string): value is ImportFormat {
  return (IMPORT_FORMATS as readonly string[]).includes(value);
}

/** File-name extension → format (`null` = unsupported/unknown). */
export function formatFromFilename(filename: string): ImportFormat | null {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return null;
  const extension = filename.slice(dot + 1).toLowerCase();
  switch (extension) {
    case 'json':
      return 'json';
    case 'csv':
      return 'csv';
    case 'html':
    case 'htm':
      return 'html';
    case 'txt':
      return 'txt';
    case 'enex':
      return 'enex';
    case 'zip':
      return 'zip';
    default:
      return null;
  }
}

/**
 * Detects the JSON dialect by content: our export carries the `format`
 * marker; a Raindrop export is recognized by its `link`-keyed items.
 * Returns null when the document is neither (caller reports a 400).
 */
export function detectJsonDialect(text: string): 'arcdrop' | 'raindrop' | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (isArcDropJson(value)) return 'arcdrop';
  if (isRaindropJson(value)) return 'raindrop';
  return null;
}

/** Parses a NON-zip payload of a known format (pure, no I/O). */
export function parsePayload(format: Exclude<ImportFormat, 'zip'>, text: string): ParsedImport {
  switch (format) {
    case 'csv':
      return parseCsvImport(text);
    case 'html':
      return parseNetscapeImport(text);
    case 'txt':
      return parseTxtImport(text);
    case 'enex':
      return parseEnexImport(text);
    case 'json': {
      const dialect = detectJsonDialect(text);
      if (dialect === 'arcdrop') return parseArcDropDocument(JSON.parse(text));
      if (dialect === 'raindrop') return parseRaindropDocument(JSON.parse(text));
      const failed = emptyParsedImport();
      failed.errors.push({
        reason: 'unrecognized JSON dialect — expected an ArcDrop or Raindrop export',
      });
      return failed;
    }
  }
}
