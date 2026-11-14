import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appRoutes } from '../../app/routes';
import { useAuthStore } from '../../stores/authStore';
import {
  makeMockBookmark,
  makeMockCollection,
  makeMockSession,
  makeMockTagUsage,
  problemJsonResponse,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { waitForLibraryReady } from '../../test/waiters';
import { ThemeController } from '../../theme/ThemeController';
import { SnackbarHost } from './SnackbarHost';

function readFormDataFilename(entry: FormDataEntryValue | null): string | null {
  if (entry && typeof entry === 'object' && 'name' in entry && typeof entry.name === 'string') {
    return entry.name;
  }
  return null;
}

function renderAt(path: string) {
  useAuthStore.getState().setSession(
    makeMockSession({
      user: { email: 'uploader@arcdrop.test' },
    }),
  );

  const router = createMemoryRouter(appRoutes, {
    initialEntries: [path],
  });

  return render(
    <ThemeController>
      <RouterProvider router={router} />
      <SnackbarHost />
    </ThemeController>,
  );
}

describe('UploadFileDialog & file round-trip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads a file with metadata, shows progress, renders file item, and downloads with Content-Disposition', async () => {
    const user = userEvent.setup({ delay: null });
    let uploadedFormData: FormData | null = null;
    let downloadAuthHeader: string | null = null;
    let downloadQueryParam: string | null = null;

    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });

    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:https://arcdrop.test/downloaded-spec');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const anchorClicks: Array<{ download: string; href: string }> = [];
    const origClick = HTMLAnchorElement.prototype.click;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      anchorClicks.push({ download: this.download, href: this.href });
      if (typeof origClick === 'function' && this.href === '') {
        origClick.call(this);
      }
    });

    server.use(
      http.get('*/api/v1/collections', () =>
        HttpResponse.json({
          items: [
            makeMockCollection({
              id: '11111111-1111-4111-8111-111111111111',
              title: 'Specs Vault',
            }),
          ],
        }),
      ),
      http.get('*/api/v1/bookmarks/tags', () =>
        HttpResponse.json([makeMockTagUsage({ id: 'tag-1', name: 'architecture', count: 1 })]),
      ),
      http.post('*/api/v1/bookmarks/file', async ({ request }) => {
        uploadedFormData = await request.formData();
        await uploadGate;
        return HttpResponse.json(
          makeMockBookmark({
            id: 'bm-uploaded-pdf',
            storageKind: 'file',
            url: null,
            urlParts: null,
            title: 'Architecture Spec',
            fileRef: 'ref-spec-pdf',
            fileName: 'architecture-spec.pdf',
            fileMime: 'application/pdf',
            fileSize: 2048,
            contentType: 'document',
            favorite: true,
            cacheStatus: 'ready',
            tags: [{ id: 'tag-1', name: 'architecture' }],
          }),
          { status: 201 },
        );
      }),
      http.get('*/api/v1/files/bm-uploaded-pdf', ({ request }) => {
        downloadAuthHeader = request.headers.get('authorization');
        downloadQueryParam = new URL(request.url).searchParams.get('download');
        return new HttpResponse(new Uint8Array([37, 80, 68, 70]), {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition':
              "attachment; filename=\"fallback.pdf\"; filename*=UTF-8''Server%20Named%20Spec.pdf",
          },
        });
      }),
    );

    renderAt('/');
    await waitForLibraryReady();

    const uploadTriggers = await screen.findAllByRole('button', { name: 'Upload file' });
    await user.click(uploadTriggers[0]!);

    const dialog = await screen.findByRole('dialog', { name: 'Upload file' });
    const fileInput = within(dialog).getByLabelText('Select file to upload');
    const pdfFile = new File(['%PDF-1.4 content'], 'architecture-spec.pdf', {
      type: 'application/pdf',
    });

    await user.upload(fileInput, pdfFile);
    expect(within(dialog).getByText('architecture-spec.pdf')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Title (optional)'), 'Architecture Spec');
    await user.click(within(dialog).getByLabelText('Collection'));
    await user.click(await screen.findByRole('option', { name: 'Specs Vault' }));

    const tagsInput = within(dialog).getByRole('combobox', { name: 'Tags' });
    await user.type(tagsInput, 'architecture{Enter}');
    await user.click(within(dialog).getByLabelText('Mark as favorite'));

    await user.click(within(dialog).getByRole('button', { name: 'Upload file' }));

    // Progress bar renders deterministically while upload request is gated.
    expect(await within(dialog).findByTestId('upload-progress')).toBeInTheDocument();
    releaseUpload();

    await waitFor(() => {
      expect(uploadedFormData).not.toBeNull();
    });
    expect(readFormDataFilename(uploadedFormData!.get('file'))).toBe('architecture-spec.pdf');
    expect(uploadedFormData!.get('title')).toBe('Architecture Spec');
    expect(uploadedFormData!.get('favorite')).toBe('true');
    expect(uploadedFormData!.get('tags')).toBe(JSON.stringify(['architecture']));
    expect(uploadedFormData!.get('collectionIds')).toBe(
      JSON.stringify(['11111111-1111-4111-8111-111111111111']),
    );

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const uploadedCard = await screen.findByTestId('bookmark-item-bm-uploaded-pdf');
    expect(within(uploadedCard).getByText('Architecture Spec')).toBeInTheDocument();
    expect(within(uploadedCard).getByText(/architecture-spec\.pdf/)).toBeInTheDocument();

    // Trigger authenticated download from the card and verify Content-Disposition is honored.
    await user.click(
      within(uploadedCard).getByRole('button', { name: 'Download file: Architecture Spec' }),
    );

    await waitFor(() => {
      expect(anchorClicks).toHaveLength(1);
    });
    expect(downloadAuthHeader).toMatch(/^Bearer /);
    expect(downloadQueryParam).toBe('1');
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:https://arcdrop.test/downloaded-spec');
    expect(anchorClicks[0]).toEqual({
      download: 'Server Named Spec.pdf',
      href: 'blob:https://arcdrop.test/downloaded-spec',
    });
  }, 60_000);

  it('supports drag-and-drop file selection and renders quota 413 reset time + limit/used metadata and 415 errors', async () => {
    const user = userEvent.setup({ delay: null });

    server.use(
      http.post('*/api/v1/bookmarks/file', async ({ request }) => {
        const formData = await request.formData();
        const fileName = readFormDataFilename(formData.get('file'));
        if (fileName?.endsWith('.html')) {
          return problemJsonResponse(415, {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            title: 'Unsupported Media Type',
            detail: 'Unsupported file media type "text/html".',
          });
        }
        return problemJsonResponse(413, {
          code: 'UPLOAD_QUOTA_EXCEEDED',
          title: 'Payload Too Large',
          detail: 'Monthly upload quota of 100 MB exceeded.',
          limitBytes: 104_857_600,
          usedBytes: 104_000_000,
          resetAt: '2026-12-01T00:00:00.000Z',
        });
      }),
    );

    renderAt('/');
    await waitForLibraryReady();

    const uploadTriggers = await screen.findAllByRole('button', { name: 'Upload file' });
    await user.click(uploadTriggers[0]!);

    const dialog = await screen.findByRole('dialog', { name: 'Upload file' });
    const dropzone = within(dialog).getByTestId('upload-dropzone');

    // Drop a disallowed HTML file -> 415
    const htmlFile = new File(['<script>alert(1)</script>'], 'unsafe.html', { type: 'text/html' });
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [htmlFile],
      },
    });
    expect(within(dialog).getByText('unsafe.html')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Upload file' }));
    const err415 = await within(dialog).findByTestId('upload-error-alert');
    expect(err415).toHaveTextContent('Unsupported file media type "text/html".');

    // Drop a valid file hitting monthly quota 413 -> shows limitBytes, usedBytes, resetAt
    const bigPdf = new File(['large'], 'archive-dump.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [bigPdf],
      },
    });

    await user.click(within(dialog).getByRole('button', { name: 'Upload file' }));
    await waitFor(() => {
      expect(within(dialog).getByTestId('upload-error-alert')).toHaveTextContent(
        'Monthly upload quota of 100 MB exceeded.',
      );
    });
    const quotaAlert = within(dialog).getByTestId('upload-error-alert');
    expect(quotaAlert).toHaveTextContent('Used this month: 99.2 MB / Limit: 100 MB');
    expect(within(quotaAlert).getByTestId('upload-quota-reset')).toHaveTextContent(
      '2026-12-01T00:00:00.000Z',
    );
  }, 60_000);
});
