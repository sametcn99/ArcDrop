import { emptyParsedImport, mergeParsedImport, type ParsedImport } from './import-model';
import { ZipParseError, readZipEntries } from './zip-reader';
import { formatFromFilename, parsePayload } from './detect-format';

/**
 * ZIP import (Raindrop parity G3): unpack the archive in memory and run
 * every SUPPORTED member through its parser, aggregating one summary.
 *
 * - Supported members are recognized by extension: `.json` `.csv` `.html`
 *   `.htm` `.txt` `.enex`;
 * - directories and unsupported extensions are skipped and COUNTED
 *   (skipped carries the member name);
 * - a member that fails to parse contributes its errors/skips with the
   member path as the source (`archive.zip/<member>`);
 * - nested ZIPs are not recursed into (one documented level only).
 */
export function parseZipImport(archive: Buffer): ParsedImport {
  const result = emptyParsedImport();

  let entries;
  try {
    entries = readZipEntries(archive);
  } catch (error) {
    const reason =
      error instanceof ZipParseError ? error.message : 'archive could not be read as a ZIP file';
    result.errors.push({ reason });
    return result;
  }

  for (const entry of entries) {
    const memberName = entry.name.replace(/^\/+/, '');
    const format = formatFromFilename(memberName);
    if (format === null || format === 'zip') {
      result.skipped.push({ reason: 'unsupported file type inside archive', source: memberName });
      continue;
    }
    // Zip-slip is structurally irrelevant (members never touch the
    // filesystem) but a path-borne name still reads badly in reports —
    // normalize the separator.
    const label = memberName.replaceAll('\\', '/');
    if (format === 'json' && looksLikeZipJson(entry.bytes)) {
      result.skipped.push({ reason: 'nested ZIP archives are not recursed into', source: label });
      continue;
    }
    const text = entry.bytes.toString('utf8');
    const memberResult = parsePayload(format, text);
    // Prefix member-level sources with the archive member name so the
    // summary pinpoints WHERE a skip/error came from.
    for (const note of memberResult.skipped) note.source = `${label}: ${note.source ?? 'file'}`;
    for (const note of memberResult.errors) note.source = `${label}: ${note.source ?? 'file'}`;
    mergeParsedImport(result, memberResult);
  }
  return result;
}

/** A `.json` member that is actually a ZIP binary (mis-named or nested). */
function looksLikeZipJson(bytes: Buffer): boolean {
  // The local-header magic `PK\x03\x04` is enough to refuse early.
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03;
}
