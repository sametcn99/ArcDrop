import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { createApiClient, parseContentDispositionFilename } from './client';
import { createBookmarksApi } from './endpoints/bookmarks';
import { makeMockBookmark, makeMockSession, problemJsonResponse } from '../test/msw/handlers';
import { server } from '../test/msw/server';

function readFormDataFilename(entry: FormDataEntryValue | null): string | null {
  if (entry && typeof entry === 'object' && 'name' in entry && typeof entry.name === 'string') {
    return entry.name;
  }
  return null;
}

describe('API client multipart upload & authenticated blob download', () => {
  it('parses RFC 5987 filename*=UTF-8 and legacy filename from Content-Disposition', () => {
    expect(
      parseContentDispositionFilename(
        `attachment; filename="fallback.pdf"; filename*=UTF-8''Quarterly%20Report%202026.pdf`,
      ),
    ).toBe('Quarterly Report 2026.pdf');

    expect(parseContentDispositionFilename('inline; filename="preview.png"')).toBe('preview.png');
    expect(parseContentDispositionFilename(null)).toBeNull();
  });

  it('uploads FormData with metadata and retries once on 401 token expiry', async () => {
    let seenAuthHeaders: string[] = [];
    let capturedFileName: string | null = null;
    let capturedTitle: FormDataEntryValue | null = null;
    let capturedTags: FormDataEntryValue | null = null;
    let capturedCollections: FormDataEntryValue | null = null;
    let capturedFavorite: FormDataEntryValue | null = null;
    let capturedContentType: string | null = null;

    server.use(
      http.post('*/api/v1/auth/refresh', () =>
        HttpResponse.json(
          makeMockSession({
            accessToken: 'access-rotated-upload',
            refreshToken: 'refresh-rotated-upload',
          }),
          { status: 201 },
        ),
      ),
      http.post('*/api/v1/bookmarks/file', async ({ request }) => {
        seenAuthHeaders = [...seenAuthHeaders, request.headers.get('authorization') ?? ''];
        if (request.headers.get('authorization') === 'Bearer access-expired') {
          return problemJsonResponse(401, {
            code: 'UNAUTHORIZED',
            detail: 'Expired token',
          });
        }

        capturedContentType = request.headers.get('content-type');
        const formData = await request.formData();
        capturedFileName = readFormDataFilename(formData.get('file'));
        capturedTitle = formData.get('title');
        capturedTags = formData.get('tags');
        capturedCollections = formData.get('collectionIds');
        capturedFavorite = formData.get('favorite');

        return HttpResponse.json(
          makeMockBookmark({
            id: 'bm-uploaded-1',
            storageKind: 'file',
            title: String(capturedTitle ?? 'report.pdf'),
            fileName: capturedFileName ?? 'report.pdf',
            fileMime: 'application/pdf',
            fileSize: 12,
            contentType: 'document',
            tags: [{ id: 't1', name: 'finance' }],
          }),
          { status: 201 },
        );
      }),
    );

    const client = createApiClient();
    client.setTokens({
      accessToken: 'access-expired',
      refreshToken: 'refresh-valid',
    });
    const api = createBookmarksApi(client);

    const file = new File(['hello-pdf'], 'report.pdf', { type: 'application/pdf' });
    const created = await api.uploadFile({
      file,
      title: 'Q4 Report',
      tags: ['finance'],
      collectionIds: ['11111111-1111-4111-8111-111111111111'],
      favorite: true,
    });

    expect(created.id).toBe('bm-uploaded-1');
    expect(created.storageKind).toBe('file');
    expect(seenAuthHeaders).toEqual(['Bearer access-expired', 'Bearer access-rotated-upload']);
    expect(capturedContentType).toMatch(/^multipart\/form-data/i);
    expect(capturedFileName).toBe('report.pdf');
    expect(capturedTitle).toBe('Q4 Report');
    expect(capturedTags).toBe(JSON.stringify(['finance']));
    expect(capturedCollections).toBe(JSON.stringify(['11111111-1111-4111-8111-111111111111']));
    expect(capturedFavorite).toBe('true');
  });

  it('fetches authenticated file blobs with ?download=1 and honors Content-Disposition', async () => {
    let capturedAuth: string | null = null;
    let capturedDownloadParam: string | null = null;

    server.use(
      http.get('*/api/v1/files/file-123', ({ request }) => {
        capturedAuth = request.headers.get('authorization');
        capturedDownloadParam = new URL(request.url).searchParams.get('download');
        return new HttpResponse(new Uint8Array([10, 20, 30]), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition':
              'attachment; filename="fallback.pdf"; filename*=UTF-8\'\'My%20Spec.pdf',
          },
        });
      }),
    );

    const client = createApiClient();
    client.setTokens({
      accessToken: 'access-token-blob',
      refreshToken: 'refresh-token-blob',
    });
    const api = createBookmarksApi(client);

    const result = await api.getFileBlob('file-123', { download: true });
    expect(capturedAuth).toBe('Bearer access-token-blob');
    expect(capturedDownloadParam).toBe('1');
    expect(result.filename).toBe('My Spec.pdf');
    expect(result.contentType).toBe('application/pdf');
    expect(result.blob.size).toBe(3);
  });
});
