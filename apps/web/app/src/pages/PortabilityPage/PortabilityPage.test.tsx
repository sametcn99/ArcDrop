import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { appRoutes } from '../../app/routes';
import { SnackbarHost } from '../../shared/components/SnackbarHost';
import { useAuthStore } from '../../stores/authStore';
import {
  makeMockBookmark,
  makeMockCollection,
  makeMockImportSummary,
  makeMockSession,
  problemJsonResponse,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { waitForPortabilityReady } from '../../test/waiters';
import { ThemeController } from '../../theme/ThemeController';

function renderPortability() {
  useAuthStore.getState().setSession(
    makeMockSession({
      user: { email: 'portability@arcdrop.test' },
    }),
  );

  const router = createMemoryRouter(appRoutes, {
    initialEntries: ['/portability'],
  });

  return render(
    <ThemeController>
      <RouterProvider router={router} />
      <SnackbarHost />
    </ThemeController>,
  );
}

describe('PortabilityPage', () => {
  it('uploads import file, handles 409 busy retry, and renders summary table with skipped and errors', async () => {
    const user = userEvent.setup({ delay: null });
    let importAttempts = 0;

    server.use(
      http.post('*/api/v1/data/import', async () => {
        importAttempts += 1;
        if (importAttempts === 1) {
          return problemJsonResponse(409, {
            code: 'IMPORT_IN_PROGRESS',
            title: 'Import Busy',
            detail: 'Another import is currently running for your account.',
          });
        }
        return HttpResponse.json(
          makeMockImportSummary({
            created: 4,
            updated: 2,
            skipped: [{ source: 'https://dup.test/a', reason: 'Duplicate URL skipped' }],
            errors: [{ source: 'row-9', reason: 'Invalid URL scheme' }],
          }),
        );
      }),
    );

    renderPortability();
    await waitForPortabilityReady();

    const fileInput = screen.getByTestId('import-file-input');
    const file = new File(['<html>bookmarks</html>'], 'bookmarks.html', { type: 'text/html' });
    await user.upload(fileInput, file);

    await user.click(screen.getByRole('button', { name: 'Start import' }));

    const busyAlert = await screen.findByTestId('import-busy-alert');
    expect(busyAlert).toHaveTextContent('Another import is currently running');

    await user.click(within(busyAlert).getByRole('button', { name: 'Retry import' }));

    const summaryPanel = await screen.findByTestId('import-summary-panel');
    expect(within(summaryPanel).getByText('Created: 4')).toBeInTheDocument();
    expect(within(summaryPanel).getByText('Updated: 2')).toBeInTheDocument();
    expect(within(summaryPanel).getByText('Skipped: 1')).toBeInTheDocument();
    expect(within(summaryPanel).getByText('Errors: 1')).toBeInTheDocument();

    const table = within(summaryPanel).getByTestId('import-summary-table');
    expect(within(table).getByText('https://dup.test/a')).toBeInTheDocument();
    expect(within(table).getByText('Duplicate URL skipped')).toBeInTheDocument();
    expect(within(table).getByText('row-9')).toBeInTheDocument();
    expect(within(table).getByText('Invalid URL scheme')).toBeInTheDocument();
    expect(importAttempts).toBe(2);
  }, 60_000);

  it('opens export dialog, sends selected format, collection scope, and includeFiles, and triggers download', async () => {
    const user = userEvent.setup({ delay: null });
    const exportPayloads: Array<{
      format: string;
      collectionId?: string;
      includeFiles?: boolean;
    }> = [];

    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:arcdrop-export-test');
    const revokeObjectUrlSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);

    const exportCol = makeMockCollection({ id: 'col-export', title: 'Export Scope' });

    server.use(
      http.get('*/api/v1/collections', () => HttpResponse.json({ items: [exportCol] })),
      http.get('*/api/v1/collections/tree', () =>
        HttpResponse.json([{ ...exportCol, children: [] }]),
      ),
      http.post('*/api/v1/data/export', async ({ request }) => {
        const body = (await request.json()) as {
          format: string;
          collectionId?: string;
          includeFiles?: boolean;
        };
        exportPayloads.push(body);
        return new HttpResponse('csv,data', {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename="arcdrop-bundle.zip"',
          },
        });
      }),
    );

    renderPortability();
    await waitForPortabilityReady();

    await user.click(screen.getByRole('button', { name: 'Export bookmarks...' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('combobox', { name: 'Export format' }));
    await user.click(await screen.findByRole('option', { name: /CSV/i }));

    await user.click(within(dialog).getByRole('combobox', { name: 'Collection scope' }));
    await user.click(await screen.findByRole('option', { name: 'Export Scope' }));

    await user.click(within(dialog).getByRole('checkbox', { name: /Include uploaded files/i }));
    await user.click(within(dialog).getByRole('button', { name: 'Download export' }));

    await waitFor(() => {
      expect(exportPayloads).toEqual([
        {
          format: 'csv',
          collectionId: 'col-export',
          includeFiles: true,
        },
      ]);
    });
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:arcdrop-export-test');

    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
  }, 60_000);

  it('exports per-bookmark highlights in TXT and CSV formats', async () => {
    const user = userEvent.setup({ delay: null });
    const requestedFormats: string[] = [];

    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:arcdrop-highlights-test');
    const revokeObjectUrlSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);

    server.use(
      http.get('*/api/v1/bookmarks', () =>
        HttpResponse.json({
          items: [makeMockBookmark({ id: 'bm-hl-1', title: 'Annotated Paper' })],
          totalCount: 1,
          page: 1,
          pageSize: 50,
        }),
      ),
      http.get('*/api/v1/bookmarks/:id/highlights/export', ({ request, params }) => {
        const format = new URL(request.url).searchParams.get('format') ?? 'txt';
        requestedFormats.push(`${String(params.id)}:${format}`);
        return new HttpResponse('highlight-export-body', {
          status: 200,
          headers: {
            'Content-Disposition': `attachment; filename="highlights-${String(params.id)}.${format}"`,
          },
        });
      }),
    );

    renderPortability();
    await waitForPortabilityReady();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Export TXT' })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: 'Export TXT' }));
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => {
      expect(requestedFormats).toEqual(['bm-hl-1:txt', 'bm-hl-1:csv']);
    });

    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
  }, 60_000);
});
