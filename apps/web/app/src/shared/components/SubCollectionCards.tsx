import { useDroppable } from '@dnd-kit/core';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router';
import type { Collection } from '../../api/schemas/collections';
import { buildCollectionDropId, useAppDnd, type DropTargetData } from '../hooks/useAppDnd';
import { SHARED_COLLECTION_STRINGS } from '../strings';
import { CollectionIcon } from './CollectionIcon';

/**
 * Grid of sub-collection cards shown above the bookmark list on a collection
 * page. Cards are clearly collection-flavoured (folder avatar + count) and
 * double as drop targets for bookmark/collection drags from the sidebar.
 */
export function SubCollectionCards({
  collections,
  enableDnd,
}: {
  collections: Collection[];
  enableDnd: boolean;
}) {
  return (
    <Stack spacing={1} data-testid="sub-collections-section">
      <Typography variant="subtitle2" color="text.secondary">
        {SHARED_COLLECTION_STRINGS.subCollectionsHeading}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, minmax(0, 1fr))',
            lg: 'repeat(3, minmax(0, 1fr))',
          },
          gap: 1.5,
        }}
      >
        {collections.map((collection) => (
          <SubCollectionCard key={collection.id} collection={collection} enableDnd={enableDnd} />
        ))}
      </Box>
    </Stack>
  );
}

function SubCollectionCard({
  collection,
  enableDnd,
}: {
  collection: Collection;
  enableDnd: boolean;
}) {
  const { activeDrag } = useAppDnd();
  const dropData: DropTargetData = { kind: 'collection-drop', collectionId: collection.id };
  const { setNodeRef, isOver } = useDroppable({
    id: buildCollectionDropId(collection.id),
    data: dropData,
    disabled: !enableDnd,
  });

  // Self-drag over its own card must not highlight (mirrors the sidebar rows).
  const isDropValid =
    enableDnd &&
    isOver &&
    !(activeDrag?.kind === 'collection' && activeDrag.collectionId === collection.id);

  return (
    <Card
      ref={setNodeRef}
      variant="outlined"
      data-testid={`sub-collection-card-${collection.id}`}
      sx={{
        bgcolor: isDropValid ? 'action.selected' : undefined,
        outline: isDropValid ? 2 : 0,
        outlineStyle: isDropValid ? 'solid' : 'none',
        outlineColor: 'primary.main',
      }}
    >
      <CardActionArea component={RouterLink} to={`/collections/${collection.id}`}>
        <CardContent sx={{ py: 1.25, px: 1.5, '&:last-child': { pb: 1.25 } }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                flexShrink: 0,
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: collection.color ?? 'action.hover',
                color: collection.color ? undefined : 'text.secondary',
              }}
            >
              <CollectionIcon
                iconName={collection.icon}
                colorValue={collection.color ? '#fff' : null}
                fontSize="small"
              />
            </Box>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
                {collection.title}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                {collection.bookmarkCount} {SHARED_COLLECTION_STRINGS.subCollectionCountSuffix}
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
