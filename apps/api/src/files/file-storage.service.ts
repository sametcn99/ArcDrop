import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { APP_CONFIG } from '@api/config/app-config.service';
import type { AppConfig } from '@api/config/env.schema';

/** `<32 base64url chars>.<ext>` — matches minted uploaded-file refs only. */
const FILE_REF_PATTERN = /^[A-Za-z0-9_-]{32}\.[a-z0-9]{1,8}$/;

/**
 * Uploaded user file storage (plan M18 / D19):
 * - Files live under `ARCDROP__DATA_DIR/files/<fileRef>`.
 * - Temporary multipart staging lives under `ARCDROP__DATA_DIR/tmp`.
 * - Unlike `/icons/{id}` (public capability tokens), uploaded files are private
 *   user content served ONLY via authenticated `GET /api/v1/files/{id}` after
 *   checking `userId` ownership on the bookmark row.
 * - `evictExcept` only unlinks files matching `FILE_REF_PATTERN`; foreign files
 *   are untouched.
 */
@Injectable()
export class FileStorageService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get filesDir(): string {
    return join(this.config.dataDir, 'files');
  }

  get tmpDir(): string {
    return join(this.config.dataDir, 'tmp');
  }

  isValidRef(ref: string): boolean {
    return FILE_REF_PATTERN.test(ref);
  }

  mintRef(extension: string): string {
    const safeExt = extension.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (safeExt.length === 0 || safeExt.length > 8) {
      throw new Error(`file storage refuses invalid extension: ${extension}`);
    }
    return `${randomBytes(24).toString('base64url')}.${safeExt}`;
  }

  /** Moves (or copies across volumes) a staged upload temp file into `files/<ref>`. */
  async storeFromTempFile(tempPath: string, extension: string): Promise<string> {
    const fileRef = this.mintRef(extension);
    await mkdir(this.filesDir, { recursive: true });
    const target = this.pathOf(fileRef);
    try {
      await rename(tempPath, target);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'EXDEV') throw error;
      await copyFile(tempPath, target);
      await unlink(tempPath).catch(() => {});
    }
    return fileRef;
  }

  /** Stores an in-memory buffer into `files/<ref>` (used by MCP base64 upload). */
  async storeBuffer(bytes: Uint8Array, extension: string): Promise<string> {
    if (bytes.byteLength === 0) {
      throw new Error('file storage refuses an empty body');
    }
    const fileRef = this.mintRef(extension);
    await mkdir(this.filesDir, { recursive: true });
    await writeFile(this.pathOf(fileRef), bytes);
    return fileRef;
  }

  /** Opens a read stream + exact byte size; returns null if missing or invalid ref. */
  async openStream(ref: string): Promise<{ stream: ReadStream; size: number } | null> {
    if (!this.isValidRef(ref)) return null;
    const target = this.pathOf(ref);
    try {
      const info = await stat(target);
      if (!info.isFile()) return null;
      return { stream: createReadStream(target), size: info.size };
    } catch {
      return null;
    }
  }

  /** Reads an entire file into memory (used for bounded MCP getFile / small reads). */
  async readBuffer(ref: string): Promise<Buffer | null> {
    if (!this.isValidRef(ref)) return null;
    try {
      return await readFile(this.pathOf(ref));
    } catch {
      return null;
    }
  }

  async remove(ref: string | null | undefined): Promise<void> {
    if (!ref || !this.isValidRef(ref)) return;
    await unlink(this.pathOf(ref)).catch(() => {});
  }

  async removeMany(refs: readonly (string | null | undefined)[]): Promise<void> {
    for (const ref of refs) {
      await this.remove(ref);
    }
  }

  /** Deletes every well-formed file NOT in `referenced`. */
  async evictExcept(referenced: ReadonlySet<string>): Promise<number> {
    let entries: string[];
    try {
      entries = await readdir(this.filesDir);
    } catch {
      return 0;
    }
    let evicted = 0;
    for (const entry of entries) {
      if (!this.isValidRef(entry) || referenced.has(entry)) continue;
      try {
        await unlink(join(this.filesDir, entry));
        evicted++;
      } catch {
        // Concurrent delete or open handle — next sweep retries.
      }
    }
    return evicted;
  }

  private pathOf(ref: string): string {
    if (!this.isValidRef(ref)) {
      throw new Error(`file storage refuses malformed ref: ${ref}`);
    }
    const base = resolve(this.filesDir);
    const target = resolve(base, ref);
    if (!target.startsWith(base + sep)) {
      throw new Error('file storage path escaped the files directory');
    }
    return target;
  }
}
