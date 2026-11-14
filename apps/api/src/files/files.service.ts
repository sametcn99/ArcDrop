import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import type { ReadStream } from 'node:fs';
import type { Repository } from 'typeorm';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import type { FileMetadataDto } from './files.dto';
import { FileStorageService } from './file-storage.service';
import { sanitizeFileName } from './file-types';

export interface OpenedPrivateFile {
  bookmark: Bookmark;
  filename: string;
  mime: string;
  size: number;
  stream: ReadStream;
}

/**
 * Private file lookup & serving service (plan M18 / D19).
 * Shared by REST `GET /api/v1/files/{id}` and MCP `getFile`.
 */
@Injectable()
export class FilesService {
  constructor(
    @InjectRepository(Bookmark) private readonly bookmarks: Repository<Bookmark>,
    private readonly storage: FileStorageService,
  ) {}

  async openOwnedFile(user: RequestUser, idOrRef: string): Promise<OpenedPrivateFile> {
    const row = await this.findOwnedFileBookmark(user.id, idOrRef);
    if (!row || !row.fileRef || !row.fileMime) {
      throw new NotFoundException('File not found');
    }

    const opened = await this.storage.openStream(row.fileRef);
    if (!opened) {
      throw new NotFoundException('File not found');
    }

    return {
      bookmark: row,
      filename: sanitizeFileName(row.fileName ?? row.fileRef),
      mime: row.fileMime,
      size: opened.size,
      stream: opened.stream,
    };
  }

  async getFileForMcp(
    user: RequestUser,
    idOrRef: string,
    maxBase64Bytes: number,
  ): Promise<FileMetadataDto> {
    const row = await this.findOwnedFileBookmark(user.id, idOrRef);
    if (!row || !row.fileRef || !row.fileMime || !row.fileName || row.fileSize === null) {
      throw new NotFoundException('File not found');
    }

    const fileSize = Number(row.fileSize);
    const base: FileMetadataDto = {
      bookmarkId: row.id,
      fileRef: row.fileRef,
      fileName: row.fileName,
      fileMime: row.fileMime,
      fileSize,
      contentType: row.contentType,
      downloadPath: `/api/v1/files/${row.id}`,
    };

    if (fileSize > maxBase64Bytes) {
      return {
        ...base,
        _note: `File exceeds the ${maxBase64Bytes} byte inline MCP cap; download via GET /api/v1/files/${row.id}`,
      };
    }

    const bytes = await this.storage.readBuffer(row.fileRef);
    if (!bytes) {
      throw new NotFoundException('File not found');
    }

    return {
      ...base,
      data: bytes.toString('base64'),
    };
  }

  private async findOwnedFileBookmark(userId: string, idOrRef: string): Promise<Bookmark | null> {
    if (isUUID(idOrRef)) {
      return this.bookmarks.findOne({
        where: { id: idOrRef, userId, storageKind: 'file' },
      });
    }
    if (this.storage.isValidRef(idOrRef)) {
      return this.bookmarks.findOne({
        where: { fileRef: idOrRef, userId, storageKind: 'file' },
      });
    }
    return null;
  }
}
