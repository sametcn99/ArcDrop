import { z } from 'zod';
import type { components } from '../types';

export const publicBookmarkSchema = z.object({
  title: z.string().nullable(),
  url: z.string().nullable(),
  excerpt: z.string().nullable(),
  coverRef: z.string().nullable(),
  iconRef: z.string().nullable(),
  tags: z.array(z.string()),
  contentType: z.enum(['article', 'image', 'video', 'audio', 'document', 'book', 'link']),
  createdAt: z.string(),
});

export interface PublicCollectionNode {
  id: string;
  title: string;
  icon: string | null;
  color: string | null;
  order: number;
  parentId: string | null;
  bookmarkCount: number;
  children: PublicCollectionNode[];
}

export const publicCollectionNodeSchema: z.ZodType<PublicCollectionNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    title: z.string(),
    icon: z.string().nullable(),
    color: z.string().nullable(),
    order: z.number(),
    parentId: z.string().nullable(),
    bookmarkCount: z.number().int(),
    children: z.array(publicCollectionNodeSchema),
  }),
);

export const publicCollectionPageSchema = z.object({
  collection: publicCollectionNodeSchema,
  collectionPath: z.string(),
  items: z.array(publicBookmarkSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalCount: z.number().int(),
});

export type PublicBookmark = z.infer<typeof publicBookmarkSchema>;
export type PublicCollectionPage = z.infer<typeof publicCollectionPageSchema>;

// Compile-time structural alignment checks against generated OpenAPI schemas.
const _pageCheck: components['schemas']['PublicCollectionPageDto'] | undefined = undefined as
  PublicCollectionPage | undefined;
const _bookmarkCheck: components['schemas']['PublicBookmarkDto'] | undefined = undefined as
  PublicBookmark | undefined;
void _pageCheck;
void _bookmarkCheck;
