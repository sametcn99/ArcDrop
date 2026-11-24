import { BadRequestException, HttpException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';
import { z } from 'zod';
import { formatFromFilename, parsePayload } from './import/detect-format';
import { emptyParsedImport, mergeParsedImport, type ParsedImport } from './import/import-model';
import type { StagedImportFile } from './import/import-model';
import { parseArcDropDocument } from './import/parse-arcdrop';

export const ARCDROP_BUNDLE_FORMAT = 'arcdrop/export-bundle/v2';
const LEGACY_BUNDLE_FORMAT = 'arcdrop/export-bundle/v1';

const bundleFile = z.object({
  bookmarkId: z.uuid(),
  fileName: z.string().min(1),
  fileMime: z.string().min(1),
  fileSize: z.number().int().positive(),
  archivePath: z.string().regex(/^files\/[^/]+$/),
  sha256: z.string().regex(/^[a-f\d]{64}$/),
});

const bundleManifest = z.object({
  format: z.enum([ARCDROP_BUNDLE_FORMAT, LEGACY_BUNDLE_FORMAT]),
  exportFormat: z.enum(['json', 'csv', 'html', 'txt']),
  document: z.enum(['export.json', 'restore.json']).optional(),
  fileCount: z.number().int().nonnegative(),
  files: z.array(bundleFile),
});

export async function transferDirectory(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, 'portable-'));
}

export function removeTransferDirectory(directory: string): Promise<void> {
  return rm(directory, { recursive: true, force: true });
}

export function limitBytes(
  maxBytes: number,
  message: string,
  consume?: (chunk: Buffer) => void,
): Transform {
  let size = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) {
        callback(new PayloadTooLargeException(message));
      } else {
        try {
          consume?.(chunk);
          callback(null, chunk);
        } catch (error) {
          callback(error as Error);
        }
      }
    },
  });
}

interface ZipReadOptions {
  expandedMax: number;
  maxEntries: number;
  documentMax: number;
  signal?: AbortSignal;
}

export async function readZipImport(
  input: string | Buffer,
  directory: string,
  options: ZipReadOptions,
): Promise<ParsedImport> {
  try {
    const zipOptions = { lazyEntries: true, autoClose: false, strictFileNames: true };
    const zip =
      typeof input === 'string'
        ? await yauzl.openPromise(input, zipOptions)
        : await yauzl.fromBufferPromise(input, zipOptions);
    try {
      return await readZipContents(zip, directory, options);
    } finally {
      zip.close();
    }
  } catch (error) {
    if (error instanceof HttpException || options.signal?.aborted) throw error;
    const result = emptyParsedImport();
    result.errors.push({ reason: 'archive could not be read as a ZIP file' });
    return result;
  }
}

async function readZipContents(
  zip: yauzl.ZipFile,
  directory: string,
  { expandedMax, maxEntries, documentMax, signal }: ZipReadOptions,
): Promise<ParsedImport> {
  if (zip.entryCount > maxEntries) throw new PayloadTooLargeException('ZIP has too many members');
  const entries = new Map<string, yauzl.Entry>();
  let expandedBytes = 0;
  for await (const entry of zip.eachEntry()) {
    signal?.throwIfAborted();
    expandedBytes += entry.uncompressedSize;
    if (expandedBytes > expandedMax) {
      throw new PayloadTooLargeException('ZIP exceeds the expanded size limit');
    }
    if (entry.fileName.endsWith('/')) continue;
    if (entries.has(entry.fileName))
      throw new BadRequestException('ZIP has duplicate member names');
    entries.set(entry.fileName, entry);
  }

  async function readDocument(entry: yauzl.Entry): Promise<string> {
    if (entry.uncompressedSize > documentMax) {
      throw new PayloadTooLargeException('ZIP document exceeds the import document size limit');
    }
    const stream = await zip.openReadStreamPromise(entry);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      signal?.throwIfAborted();
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  const manifest = entries.get('manifest.json');
  let rawManifest: unknown;
  if (manifest) {
    const text = await readDocument(manifest);
    try {
      rawManifest = JSON.parse(text);
    } catch {
      // Generic ZIPs may include an unrelated manifest.
    }
  }
  const format = (rawManifest as { format?: unknown } | null)?.format;
  if (typeof format !== 'string' || !format.startsWith('arcdrop/export-bundle/')) {
    return readGenericZip(entries, readDocument, documentMax);
  }

  const parsedManifest = bundleManifest.safeParse(rawManifest);
  if (!parsedManifest.success) throw new BadRequestException('Invalid ArcDrop bundle manifest');
  const bundle = parsedManifest.data;
  if (bundle.format === LEGACY_BUNDLE_FORMAT && bundle.exportFormat !== 'json') {
    throw new BadRequestException(
      'This older ArcDrop ZIP has no full restore document. Import the extracted export file and upload its attachments separately.',
    );
  }
  const documentName = bundle.format === LEGACY_BUNDLE_FORMAT ? 'export.json' : bundle.document;
  const documentEntry = documentName ? entries.get(documentName) : undefined;
  if (!documentEntry || bundle.fileCount !== bundle.files.length) {
    throw new BadRequestException(
      'ArcDrop bundle is missing its restore document or file manifest',
    );
  }

  let document: unknown;
  try {
    document = JSON.parse(await readDocument(documentEntry));
  } catch (error) {
    if (error instanceof HttpException || signal?.aborted) throw error;
    throw new BadRequestException('ArcDrop bundle contains an invalid restore document');
  }
  if ((document as { format?: unknown } | null)?.format !== 'arcdrop/v1') {
    throw new BadRequestException('ArcDrop bundle contains an unrecognized restore document');
  }

  const files = new Map<string, StagedImportFile>();
  const bookmarkIds = new Set<string>();
  for (const file of bundle.files) {
    signal?.throwIfAborted();
    const entry = entries.get(file.archivePath);
    const sourceId = file.bookmarkId.toLowerCase();
    if (
      !entry ||
      entry.uncompressedSize !== file.fileSize ||
      files.has(file.archivePath) ||
      bookmarkIds.has(sourceId)
    ) {
      throw new BadRequestException('ArcDrop bundle file entries do not match the manifest');
    }

    const path = join(directory, `attachment-${files.size}`);
    const hash = createHash('sha256');
    const stream = await zip.openReadStreamPromise(entry);
    await pipeline(
      stream,
      limitBytes(file.fileSize, 'Bundle file exceeds its declared size', (chunk) =>
        hash.update(chunk),
      ),
      createWriteStream(path, { flags: 'wx', mode: 0o600 }),
      { signal },
    );
    if (hash.digest('hex') !== file.sha256) {
      throw new BadRequestException(`Bundle file failed its SHA-256 check: ${file.fileName}`);
    }
    files.set(file.archivePath, {
      sourceId,
      path,
      fileName: file.fileName,
      fileMime: file.fileMime,
      fileSize: file.fileSize,
    });
    bookmarkIds.add(sourceId);
  }

  const restored = parseArcDropDocument(document, files);
  const restoredFiles = restored.fileBookmarks ?? [];
  const restoredPaths = new Set(restoredFiles.map((item) => item.file.path));
  if (
    restored.errors.length > 0 ||
    restoredPaths.size !== files.size ||
    restoredFiles.length !== restoredPaths.size
  ) {
    throw new BadRequestException(
      restored.errors[0]?.reason ?? 'Restore document does not match the bundle manifest',
    );
  }
  return restored;
}

async function readGenericZip(
  entries: ReadonlyMap<string, yauzl.Entry>,
  readDocument: (entry: yauzl.Entry) => Promise<string>,
  documentMax: number,
): Promise<ParsedImport> {
  const result = emptyParsedImport();
  let documentBytes = 0;
  for (const [name, entry] of entries) {
    const format = formatFromFilename(name);
    if (!format || format === 'zip') {
      result.skipped.push({ reason: 'unsupported file type inside archive', source: name });
      continue;
    }
    documentBytes += entry.uncompressedSize;
    if (documentBytes > documentMax) {
      throw new PayloadTooLargeException('ZIP documents exceed the import document size limit');
    }
    const member = parsePayload(format, await readDocument(entry));
    for (const note of [...member.skipped, ...member.errors]) {
      note.source = `${name}: ${note.source ?? 'file'}`;
    }
    mergeParsedImport(result, member);
  }
  return result;
}
