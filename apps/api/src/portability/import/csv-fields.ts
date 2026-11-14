/**
 * RFC 4180-ish CSV field splitter (plan M8) — no dependency, lenient where a
 * hand-exported file deserves leniency:
 *
 * - fields may be quoted; inside quotes `""` is an escaped quote, commas and
 *   CRLF/LF are literal;
 * - records end at CRLF, LF or (leniently) a lone CR;
 * - an unterminated quote at EOF is tolerated (the remainder is one field) —
 *   a hard error would lose the whole file to one bad row;
 * - the trailing newline produces no phantom record; empty lines are skipped.
 *
 * Exported because the Netscape/TXT tests and the CSV parser share it.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  const endField = (): void => {
    record.push(field);
    field = '';
  };
  const endRecord = (): void => {
    endField();
    // Skip fully-empty lines (only produced by `\n\n` or a trailing newline).
    if (record.length > 1 || (record.length === 1 && record[0] !== '')) {
      rows.push(record);
    }
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '' && !inQuotes) {
      // A quote at FIELD start opens quoting (mid-field quotes are literal;
      // the record may already be started — `a,"b"` is the normal case).
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      endField();
      continue;
    }
    if (char === '\n' || char === '\r') {
      // CRLF counts as one break; a lone CR is a lenient record break.
      if (char === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      continue;
    }
    field += char;
  }
  if (inQuotes || field !== '' || record.length > 0) endRecord();
  return rows;
}

/** Splits a delimited sub-field (tags / collection lists) on `;`. */
export function splitSemicolonList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  return raw
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
