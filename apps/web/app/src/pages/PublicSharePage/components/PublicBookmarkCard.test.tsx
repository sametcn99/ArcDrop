import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PublicBookmark } from '../../../api/schemas/publicShare';
import { ThemeController } from '../../../theme/ThemeController';
import { PublicBookmarkCard } from './PublicBookmarkCard';

function makePublicBookmark(overrides: Partial<PublicBookmark> = {}): PublicBookmark {
  return {
    title: 'Public Article',
    url: 'https://arcdrop.test/public-article',
    excerpt: 'A publicly shared article.',
    coverRef: null,
    iconRef: null,
    tags: ['shared'],
    contentType: 'article',
    createdAt: '2026-11-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('PublicBookmarkCard cover image', () => {
  it('renders the cover image from the public /icons surface when coverRef is set', () => {
    render(
      <ThemeController>
        <PublicBookmarkCard bookmark={makePublicBookmark({ coverRef: 'cover-ref-abc' })} />
      </ThemeController>,
    );

    const cover = screen.getByTestId('public-bookmark-cover');
    expect(cover).toHaveAttribute('src', expect.stringContaining('/api/v1/icons/cover-ref-abc'));
  });

  it('renders no cover element when coverRef is null', () => {
    render(
      <ThemeController>
        <PublicBookmarkCard bookmark={makePublicBookmark()} />
      </ThemeController>,
    );

    expect(screen.queryByTestId('public-bookmark-cover')).not.toBeInTheDocument();
  });
});
