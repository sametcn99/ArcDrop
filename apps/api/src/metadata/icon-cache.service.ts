import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { APP_CONFIG } from '@api/config/app-config.service';
import type { AppConfig } from '@api/config/env.schema';
import { MAX_RESPONSE_BYTES } from './ssrf-fetch.service';

/**
 * Icon cache (plan D18): binary blobs live as files under
 * `ARCDROP__DATA_DIR/icons`, referenced from `bookmarks.cover_ref` /
 * `bookmarks.icon_ref` by their FILE NAME (e.g. `Vx8…aQ.png`).
 *
 * - **Unguessable ids:** 24 random bytes → 32-char base64url (192-bit
 *   entropy, `node:crypto` — the nanoid-equivalent the ticket allows for;
 *   no new dependency). The id is the capability: whoever holds the ref can
 *   read the bytes, which is exactly why the serve route is public (D18)
 *   and why the name doubles as the stored key.
 * - **Content-type validated at write time** against a strict allowlist.
 *   `image/svg+xml` is deliberately EXCLUDED — a self-hosted instance
 *   serving attacker-supplied SVG from its own origin is stored XSS
 *   (an `<img>` tag cannot execute scripts, but direct navigation can).
 * - The file extension is the content-type record: the serve route maps
 *   it back, so serving needs no database row at all.
 * - Eviction (`evictExcept`) only ever unlinks files whose names match the
 *   ref pattern — foreign files dropped into the directory are never
 *   touched.
 */
@Injectable()
export class IconCacheService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get iconsDir(): string {
    return join(this.config.dataDir, 'icons');
  }

  /**
   * The write-side allowlist: fetched content type → file extension.
   * The serve side maps extensions back to exact media types.
   */
  private static readonly STORE_TYPES: ReadonlyMap<string, string> = new Map([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/gif', 'gif'],
    ['image/webp', 'webp'],
    ['image/avif', 'avif'],
    ['image/x-icon', 'ico'],
    ['image/vnd.microsoft.icon', 'ico'],
  ]);

  private static readonly SERVE_TYPES: ReadonlyMap<string, string> = new Map([
    ['png', 'image/png'],
    ['jpg', 'image/jpeg'],
    ['gif', 'image/gif'],
    ['webp', 'image/webp'],
    ['avif', 'image/avif'],
    ['ico', 'image/x-icon'],
  ]);

  /** `<32 base64url chars>.<png|jpg|gif|webp|avif|ico>` — nothing else resolves. */
  private static readonly REF_PATTERN = /^[A-Za-z0-9_-]{32}\.(png|jpg|gif|webp|avif|ico)$/;

  isValidRef(ref: string): boolean {
    return IconCacheService.REF_PATTERN.test(ref);
  }

  /** The media type a ref serves as; null for malformed refs. */
  contentTypeOf(ref: string): string | null {
    const ext = ref.slice(ref.lastIndexOf('.') + 1).toLowerCase();
    return IconCacheService.SERVE_TYPES.get(ext) ?? null;
  }

  /**
   * Validates the content type, mints an unguessable ref and writes the
   * file. Returns the ref (the value stored on the bookmark row).
   */
  async store(bytes: Uint8Array, contentType: string): Promise<string> {
    const ext = IconCacheService.STORE_TYPES.get(contentType.toLowerCase());
    if (!ext) throw new Error(`icon cache refuses content type: ${contentType}`);
    if (bytes.byteLength === 0) throw new Error('icon cache refuses an empty body');
    if (bytes.byteLength > MAX_RESPONSE_BYTES)
      throw new Error('icon cache refuses oversized bodies');

    const ref = `${randomBytes(24).toString('base64url')}.${ext}`;
    await mkdir(this.iconsDir, { recursive: true });
    await writeFile(this.pathOf(ref), bytes);
    return ref;
  }

  /** Reads a stored icon; null when the ref is malformed or the file is gone. */
  async read(ref: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    if (!this.isValidRef(ref)) return null;
    try {
      const bytes = await readFile(this.pathOf(ref));
      const contentType = this.contentTypeOf(ref);
      if (!contentType) return null;
      return { bytes: new Uint8Array(bytes), contentType };
    } catch {
      return null;
    }
  }

  /** Containment-checked path for a VALIDATED ref; throws for malformed refs. */
  private pathOf(ref: string): string {
    if (!this.isValidRef(ref)) throw new Error(`icon cache refuses malformed ref: ${ref}`);
    const base = resolve(this.iconsDir);
    const path = resolve(base, ref);
    if (path !== base && !path.startsWith(base + sep)) {
      // Defense in depth — the ref pattern already excludes separators.
      throw new Error('icon cache path escaped the icons directory');
    }
    return path;
  }

  /**
   * Deletes every well-formed icon file NOT in `referenced`. Returns the
   * number of files removed. Never touches foreign files.
   */
  async evictExcept(referenced: ReadonlySet<string>): Promise<number> {
    let entries: string[];
    try {
      entries = await readdir(this.iconsDir);
    } catch {
      return 0; // no directory yet = nothing to evict
    }
    let evicted = 0;
    for (const entry of entries) {
      if (!this.isValidRef(entry) || referenced.has(entry)) continue;
      try {
        await unlink(join(this.iconsDir, entry));
        evicted++;
      } catch {
        // A concurrent reader won the race — leave it, the next sweep retries.
      }
    }
    return evicted;
  }
}
