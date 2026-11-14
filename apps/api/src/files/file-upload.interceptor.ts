import {
  BadRequestException,
  CallHandler,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type { Request, Response } from 'express';
import multer from 'multer';
import type { Observable } from 'rxjs';
import { SettingsService } from '@api/settings/settings.service';
import { FileStorageService } from './file-storage.service';

/** Staged multipart upload handed to `POST /bookmarks/file`. */
export interface UploadedBookmarkFilePayload {
  path: string;
  size: number;
  originalname: string;
  mimetype: string;
}

function fileOf(request: Request): UploadedBookmarkFilePayload | undefined {
  const file = (request as unknown as { file?: UploadedBookmarkFilePayload }).file;
  if (file === undefined) return undefined;
  return {
    path: file.path,
    size: file.size,
    originalname: file.originalname,
    mimetype: file.mimetype,
  };
}

/** Param decorator returning the staged upload created by `FileUploadInterceptor`. */
export const UploadedBookmarkFile = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UploadedBookmarkFilePayload => {
    const file = fileOf(context.switchToHttp().getRequest<Request>());
    if (file === undefined) {
      throw new Error('UploadedBookmarkFile used on a route without FileUploadInterceptor');
    }
    return file;
  },
);

/**
 * Dynamic disk-streaming multipart interceptor for `POST /bookmarks/file` (plan M18 / D19).
 *
 * Streams the incoming `file` part directly to `ARCDROP__DATA_DIR/tmp` rather
 * than buffering up to 300 MB in memory, enforcing the live `fileMaxBytes`
 * runtime setting during the stream so oversized uploads fail immediately
 * with an RFC 7807 `413 Payload Too Large` containing `limitBytes`.
 */
@Injectable()
export class FileUploadInterceptor implements NestInterceptor {
  constructor(
    private readonly settings: SettingsService,
    private readonly storage: FileStorageService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const fileMaxBytes = await this.settings.get('fileMaxBytes');
    const tmpDir = this.storage.tmpDir;
    mkdirSync(tmpDir, { recursive: true });

    let tempFilePath: string | undefined;

    await new Promise<void>((resolve, reject) => {
      const storage = multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, tmpDir),
        filename: (_req, _file, cb) => {
          const name = `upload-${randomUUID()}`;
          tempFilePath = `${tmpDir}/${name}`;
          cb(null, name);
        },
      });

      const handler = multer({
        storage,
        limits: {
          files: 1,
          fields: 20,
          parts: 25,
          fileSize: fileMaxBytes,
        },
      }).single('file');

      handler(request, response, (error?: unknown) => {
        if (error === undefined || error === null) {
          resolve();
          return;
        }
        const stagedPath = fileOf(request)?.path ?? tempFilePath;
        if (stagedPath) {
          void unlink(stagedPath).catch(() => {});
        }
        reject(this.translate(error, fileMaxBytes));
      });
    });

    const file = fileOf(request);
    if (file === undefined) {
      throw new BadRequestException("multipart field 'file' is required (form-data upload)");
    }
    if (file.size === 0) {
      await unlink(file.path).catch(() => {});
      throw new BadRequestException('uploaded file must not be empty');
    }
    if (file.size > fileMaxBytes) {
      await unlink(file.path).catch(() => {});
      throw new PayloadTooLargeException({
        code: 'PAYLOAD_TOO_LARGE',
        message:
          `Uploaded file exceeds the ${fileMaxBytes} byte per-file limit. ` +
          `Reduce the file size below ${fileMaxBytes} bytes or have an admin raise fileMaxBytes.`,
        limitBytes: fileMaxBytes,
      });
    }

    return next.handle();
  }

  private translate(error: unknown, fileMaxBytes: number): Error {
    const code = (error as { code?: string }).code;
    if (code === 'LIMIT_FILE_SIZE') {
      return new PayloadTooLargeException({
        code: 'PAYLOAD_TOO_LARGE',
        message:
          `Uploaded file exceeds the ${fileMaxBytes} byte per-file limit. ` +
          `Reduce the file size below ${fileMaxBytes} bytes or have an admin raise fileMaxBytes.`,
        limitBytes: fileMaxBytes,
      });
    }
    const message = error instanceof Error ? error.message : 'upload could not be parsed';
    return new BadRequestException(
      message.startsWith('Multipart:') ? 'request must be multipart/form-data' : message,
    );
  }
}
