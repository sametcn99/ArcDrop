import Typography from '@mui/material/Typography';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useLibraryStore } from '../../stores/libraryStore';
import { ThemeController } from '../../theme/ThemeController';
import { SearchBar } from './SearchBar';

function LocationMirror() {
  const location = useLocation();
  return (
    <Typography data-testid="location-mirror">{`${location.pathname}${location.search}`}</Typography>
  );
}

function renderSearchBarAt(initialPath = '/', narrow = false) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <>
            <SearchBar narrow={narrow} />
            <LocationMirror />
          </>
        ),
      },
    ],
    { initialEntries: [initialPath] },
  );

  const utils = render(
    <ThemeController>
      <RouterProvider router={router} />
    </ThemeController>,
  );

  return { ...utils, router };
}

describe('SearchBar', () => {
  it('opens grammar cheatsheet popover on focus/?, inserts examples, and closes on Escape', async () => {
    const user = userEvent.setup({ delay: null });
    renderSearchBarAt('/');

    const helpBtn = screen.getByRole('button', { name: 'Search syntax help' });
    await user.click(helpBtn);

    const popover = await screen.findByTestId('search-cheatsheet-popover');
    expect(popover).toHaveTextContent('Search operator cheatsheet');
    expect(popover).toHaveTextContent('type:video');
    expect(popover).toHaveTextContent('created:>=2026-01-01');

    await user.click(screen.getByRole('button', { name: 'type:video' }));
    expect(screen.getByRole('textbox', { name: 'Search bookmarks' })).toHaveValue('type:video ');
    await waitFor(() => {
      expect(screen.getByTestId('location-mirror')).toHaveTextContent('/?search=type%3Avideo');
    });

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByTestId('search-cheatsheet-popover')).not.toBeInTheDocument();
    });
  }, 30_000);

  it('offers live #tag prefix suggestions from library tags and inserts selected tag token', async () => {
    const user = userEvent.setup({ delay: null });
    useLibraryStore.getState().hydrateTags([
      { id: 'tag-1', name: 'architecture', count: 4 },
      { id: 'tag-2', name: 'reading list', count: 2 },
    ]);

    renderSearchBarAt('/');
    const input = screen.getByRole('textbox', { name: 'Search bookmarks' });
    await user.click(input);
    await user.type(input, '#arch');

    const suggestionChip = await screen.findByRole('button', { name: '#architecture (4)' });
    await user.click(suggestionChip);

    expect(input).toHaveValue('#architecture ');
    await waitFor(() => {
      expect(screen.getByTestId('location-mirror')).toHaveTextContent('/?search=%23architecture');
    });
  }, 30_000);

  it('debounces typing, submits immediately on Enter, clears cleanly, and navigates from non-library routes', async () => {
    const user = userEvent.setup({ delay: null });
    renderSearchBarAt('/settings');

    const input = screen.getByRole('textbox', { name: 'Search bookmarks' });
    await user.type(input, 'offline sync');

    // Immediate Enter submit navigates from /settings -> /?search=...
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.getByTestId('location-mirror')).toHaveTextContent('/?search=offline%20sync');
    });

    // Clear removes search param
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveValue('');
    await waitFor(() => {
      expect(screen.getByTestId('location-mirror').textContent).toBe('/');
    });

    // Typing without Enter debounces (250ms) and updates URL param
    await user.type(input, '-spam');
    await waitFor(
      () => {
        expect(screen.getByTestId('location-mirror')).toHaveTextContent('/?search=-spam');
      },
      { timeout: 3000 },
    );
  }, 30_000);

  it('renders friendly inline errors for reserved/unknown operators and clears on input edit', async () => {
    const user = userEvent.setup({ delay: null });
    renderSearchBarAt('/?search=before%3A2026-01-01');

    act(() => {
      useLibraryStore.getState().setSearchError({
        query: 'before:2026-01-01',
        status: 400,
        code: 'RESERVED_OPERATOR',
        detail: 'Operator "before:" is reserved and not available yet.',
      });
    });

    const inlineError = await screen.findByTestId('search-inline-error');
    expect(inlineError).toHaveTextContent('Operator "before:" is reserved and not available yet.');
    expect(inlineError).toHaveTextContent('Open the syntax cheatsheet (?)');

    const input = screen.getByRole('textbox', { name: 'Search bookmarks' });
    expect(input).toHaveAttribute('aria-invalid', 'true');

    await user.type(input, ' ok');
    expect(screen.queryByTestId('search-inline-error')).not.toBeInTheDocument();
  }, 30_000);

  it('renders as an icon button when narrow and opens the search dialog', async () => {
    const user = userEvent.setup({ delay: null });

    // Active search is flagged on the icon via the dot badge
    renderSearchBarAt('/?search=existing', true);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    const searchButton = screen.getByTestId('appbar-search-button');
    expect(searchButton).toBeInTheDocument();
    expect(searchButton.querySelector('.MuiBadge-dot')).not.toBeNull();

    await user.click(searchButton);

    // Dialog carries the same committing field, prefilled from the URL
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Search bookmarks' })).toBeInTheDocument();
    const input = within(dialog).getByRole('textbox', { name: 'Search bookmarks' });
    expect(input).toHaveValue('existing');

    await user.type(input, ' extra');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.getByTestId('location-mirror')).toHaveTextContent('/?search=existing+extra');
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  }, 30_000);

  it('shows no active-search dot badge when no search is applied', async () => {
    renderSearchBarAt('/', true);

    const searchButton = screen.getByTestId('appbar-search-button');
    expect(searchButton).toBeInTheDocument();
    expect(searchButton.querySelector('.MuiBadge-dot')).toBeNull();
  }, 30_000);
});
