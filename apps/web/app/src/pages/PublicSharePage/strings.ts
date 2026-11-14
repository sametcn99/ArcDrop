export const PUBLIC_SHARE_STRINGS = {
  title: 'Shared collection',
  rssButton: 'RSS feed',
  bookmarksCount: (count: number) => `${count} bookmark${count === 1 ? '' : 's'}`,
  notFoundTitle: 'This shared collection is not available',
  notFoundDescription:
    'The link may be wrong, expired, or the collection is no longer shared publicly.',
  errorTitle: 'Could not load this shared collection',
  loadMore: 'Load more',
  fileItem: 'File item',
  emptyTitle: 'Nothing here yet',
  poweredBy: 'Powered by ArcDrop',
} as const;
