import {
  BadRequestException,
  CallHandler,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer from 'multer';
import type { Observable } from 'rxjs';
import { AppConfigService } from '@api/config/app-config.service';

/** What the controller handler receives for `POST /data/import`. */
export interface ImportFilePayload {
  buffer: Buffer;
  size: number;
  originalname: string;
}

/**
 * Reads the parsed upload the interceptor attached to the request. Typed
 * through a structural cast — `@types/express` v5 already declares
 * `Request.file` (as Express.Multer.File via @types/multer), and the
 * handler contract here is the normalized payload above.
 */
function fileOf(request: Request): ImportFilePayload | undefined {
  const file = (request as unknown as { file?: ImportFilePayload }).file;
  if (file === undefined) return undefined;
  return { buffer: file.buffer, size: file.size, originalname: file.originalname };
}

/** Param decorator handing the parsed upload to the controller handler. */
export const ImportFile = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ImportFilePayload => {
    const file = fileOf(context.switchToHttp().getRequest<Request>());
    if (file === undefined) {
      // Only reachable if the interceptor was forgotten — fail loudly.
      throw new Error('ImportFile used on a route without the ImportUploadInterceptor');
    }
    return file;
  },
);

/**
 * Multipart upload handling for `POST /data/import` (plan M8).
 *
 * Why not `FileInterceptor`: the cap is CONFIG-DRIVEN (not a decorator
 * constant) and format-dependent (ZIP archives get the larger cap), so the
 * multer invocation has to be dynamic. Enforcement is DURING the streaming
 * upload with the LARGER (ZIP) cap — an oversized body dies mid-stream,
 * never after buffering — and the tighter non-ZIP cap is checked right
 * after, before the handler runs. Errors translate to problem+json:
 * `LIMIT_FILE_SIZE` → 413, every other multer failure → 400.
 *
 * Memory posture: `memoryStorage` — one upload lives in RAM at a time
 * (≤ `importZipMaxBytes`, default 300 MB). Single-instance v1 accepts that;
 * noted in the README.
 */
@Injectable()
export class ImportUploadInterceptor implements NestInterceptor {
  constructor(private readonly config: AppConfigService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    await new Promise<void>((resolve, reject) => {
      const handler = multer({
        storage: multer.memoryStorage(),
        limits: {
          files: 1,
          fields: 10,
          parts: 10,
          // Stream-time enforcement uses the LARGER cap; the tighter
          // non-ZIP cap is applied below, once the filename is known.
          fileSize: this.config.portabilityImportZipMaxBytes,
        },
      }).single('file');
      handler(request, response, (error?: unknown) => {
        if (error === undefined || error === null) {
          resolve();
          return;
        }
        reject(this.translate(error));
      });
    });

    const file = fileOf(request);
    if (file === undefined) {
      throw new BadRequestException("multipart field 'file' is required (form-data upload)");
    }
    const isZip = file.originalname.toLowerCase().endsWith('.zip');
    const cap = isZip
      ? this.config.portabilityImportZipMaxBytes
      : this.config.portabilityImportMaxBytes;
    if (file.size > cap) {
      throw new PayloadTooLargeException(
        `import upload exceeds the ${cap} byte cap${isZip ? ' for ZIP archives' : ''}`,
      );
    }
    return next.handle();
  }

  /** Multer failures → the problem+json contract (D9). */
  private translate(error: unknown): Error {
    const code = (error as { code?: string }).code;
    if (code === 'LIMIT_FILE_SIZE') {
      return new PayloadTooLargeException(
        `import upload exceeds the ${this.config.portabilityImportZipMaxBytes} byte cap`,
      );
    }
    const message = error instanceof Error ? error.message : 'upload could not be parsed';
    return new BadRequestException(
      message.startsWith('Multipart:') ? 'request must be multipart/form-data' : message,
    );
  }
}
