import { inflateRawSync } from 'node:zlib';

/**
 * Minimal classic-ZIP reader (plan M8 ZIP import) — no dependency, only what
 * an export-archive import needs:
 *
 * - locates the END OF CENTRAL DIRECTORY record from the tail (the archive
 *   may carry a comment, so the scan walks back up to 64 KiB);
 * - reads the central directory (file headers), skipping directory entries;
 *   zip64 archives (> 65535 entries / members ≥ 4 GiB) refuse with a clear
 *   error — documented v1 limitation;
 * - decompresses `stored` (method 0) and `deflate` (method 8) members — the
 *   two methods every mainstream archiver writes for exported files;
 * - refuses encrypted members instead of yielding garbage.
 *
 * Security posture: entries are resolved INSIDE the archive only (there is
 * no filesystem extraction — the caller gets `{ name, bytes }` pairs and
 * feeds its own parsers), so zip-slip does not apply.
 */
export interface ZipEntry {
  name: string;
  bytes: Buffer;
}

export class ZipParseError extends Error {}

interface CentralDirectoryEntry {
  name: string;
  compressedSize: number;
  localHeaderOffset: number;
  method: number;
  flags: number;
}

const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export function readZipEntries(archive: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(archive);
  if (eocd === -1) {
    throw new ZipParseError('not a ZIP archive (no end-of-central-directory record)');
  }

  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    // Zip64 markers — this v1 reader handles classic archives only.
    throw new ZipParseError('zip64 archives are not supported');
  }

  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > archive.byteLength || view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new ZipParseError('corrupt central directory');
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');

    if (!name.endsWith('/')) {
      const bytes = extractMember(archive, view, {
        name,
        compressedSize,
        localHeaderOffset,
        method,
        flags,
      });
      if (bytes !== null) entries.push({ name, bytes });
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Decompresses one member; returns null for members to skip (directories). */
function extractMember(
  archive: Buffer,
  view: DataView,
  entry: CentralDirectoryEntry,
): Buffer | null {
  if (entry.name.endsWith('/')) return null; // directory entry
  if ((entry.flags & 0x1) !== 0) {
    throw new ZipParseError(`encrypted archive member "${entry.name}" is not supported`);
  }

  // The LOCAL header carries the real name/extra lengths — trust it for the
  // data offset (central values may differ under some archivers).
  const local = entry.localHeaderOffset;
  if (local + 30 > archive.byteLength || view.getUint32(local, true) !== LOCAL_SIGNATURE) {
    throw new ZipParseError(`corrupt local header for "${entry.name}"`);
  }
  const localNameLength = view.getUint16(local + 26, true);
  const localExtraLength = view.getUint16(local + 28, true);
  const dataStart = local + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > archive.byteLength) {
    throw new ZipParseError(`truncated member "${entry.name}"`);
  }
  const data = archive.subarray(dataStart, dataEnd);

  if (entry.method === 0) return Buffer.from(data); // stored — copy out
  if (entry.method === 8) {
    try {
      return inflateRawSync(data);
    } catch {
      throw new ZipParseError(`failed to decompress member "${entry.name}"`);
    }
  }
  throw new ZipParseError(
    `unsupported compression method ${entry.method} for member "${entry.name}"`,
  );
}

/** Finds the EOCD record offset, scanning back over a possible comment. */
function findEndOfCentralDirectory(archive: Buffer): number {
  const minOffset = Math.max(0, archive.length - 22 - 65_536);
  for (let i = archive.length - 22; i >= minOffset; i--) {
    if (
      archive[i] === 0x50 &&
      archive[i + 1] === 0x4b &&
      archive[i + 2] === 0x05 &&
      archive[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return -1;
}
