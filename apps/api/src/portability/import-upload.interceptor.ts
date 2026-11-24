import {
  BadRequestException,
  ConflictException,
  createParamDecorator,
  HttpException,
  Injectable,
  PayloadTooLargeException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer from 'multer';
import { defer, lastValueFrom, type Observable } from 'rxjs';
import { AppConfigService } from '@api/config/app-config.service';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import { FileStorageService } from '@api/files/file-storage.service';
import { PortabilityService } from './portability.service';
import { removeTransferDirectory, transferDirectory } from './zip-transfer';

export interface ImportFilePayload {
  path: string;
  size: number;
  originalname: string;
  signal: AbortSignal;
}

type UploadRequest = Request & { user: RequestUser; portabilityUpload?: ImportFilePayload };

export const ImportFile = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ImportFilePayload => {
    const file = context.switchToHttp().getRequest<UploadRequest>().portabilityUpload;
    if (!file) throw new Error('Missing staged portability upload');
    return file;
  },
);

@Injectable()
export class ImportUploadInterceptor implements NestInterceptor {
  constructor(
    private readonly config: AppConfigService,
    private readonly storage: FileStorageService,
    private readonly portability: PortabilityService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<UploadRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    return defer(() => this.handleUpload(request, response, next));
  }

  private async handleUpload(request: UploadRequest, response: Response, next: CallHandler) {
    const releaseImport = this.portability.acquireImportLock(request.user.id);
    if (!releaseImport) throw new ConflictException('An import is already running for this user');

    const controller = new AbortController();
    const abort = () => controller.abort();
    response.once('close', abort);
    let directory: string | undefined;
    const lease: { releaseZip?: () => void } = {};
    try {
      directory = await transferDirectory(this.storage.tmpDir);
      const handler = multer({
        dest: directory,
        limits: {
          files: 1,
          fields: 10,
          parts: 10,
          fileSize: this.config.portabilityImportZipMaxBytes,
        },
        fileFilter: (_req, file, callback) => {
          try {
            if (file.originalname.toLowerCase().endsWith('.zip')) {
              lease.releaseZip = this.portability.acquireZipTransfer();
            }
            callback(null, true);
          } catch (error) {
            callback(error as Error);
          }
        },
      }).single('file');
      await new Promise<void>((resolve, reject) => {
        if (controller.signal.aborted) return reject(controller.signal.reason);
        const onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', onAbort, { once: true });
        handler(request, response, (error?: unknown) => {
          controller.signal.removeEventListener('abort', onAbort);
          if (error == null) resolve();
          else reject(this.translate(error));
        });
      });
      if (!request.file)
        throw new BadRequestException("multipart field 'file' is required (form-data upload)");
      const { path, size, originalname } = request.file;
      if (!lease.releaseZip && size > this.config.portabilityImportMaxBytes) {
        throw new PayloadTooLargeException(
          `import upload exceeds the ${this.config.portabilityImportMaxBytes} byte cap`,
        );
      }
      request.portabilityUpload = { path, size, originalname, signal: controller.signal };
      return await lastValueFrom(next.handle());
    } finally {
      response.off('close', abort);
      try {
        if (directory) await removeTransferDirectory(directory);
      } finally {
        lease.releaseZip?.();
        releaseImport();
      }
    }
  }

  private translate(error: unknown): Error {
    if (error instanceof HttpException) return error;
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
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
