import { z } from 'zod';
import type { components, operations } from '../types';

export const exportFormatSchema = z.enum(['json', 'csv', 'html', 'txt']);

export const exportDataRequestSchema = z.object({
  format: exportFormatSchema,
  collectionId: z.string().optional(),
  includeFiles: z.boolean().default(false),
});

export const importSummaryEntrySchema = z.object({
  reason: z.string(),
  source: z.string().optional(),
});

export const importSummarySchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.array(importSummaryEntrySchema),
  errors: z.array(importSummaryEntrySchema),
});

export const highlightsExportFormatSchema = z.enum(['txt', 'csv']);

export type ExportFormat = z.infer<typeof exportFormatSchema>;
export type ExportDataRequest = z.input<typeof exportDataRequestSchema>;
export type ImportSummaryEntry = z.infer<typeof importSummaryEntrySchema>;
export type ImportSummary = z.infer<typeof importSummarySchema>;
export type HighlightsExportFormat = z.infer<typeof highlightsExportFormatSchema>;

// Compile-time structural alignment checks against generated OpenAPI schemas.
const _exportDataCheck: components['schemas']['ExportDataDto'] | undefined = undefined as
  | z.infer<typeof exportDataRequestSchema>
  | undefined;
const _importSummaryEntryCheck: components['schemas']['ImportSummaryEntryDto'] | undefined =
  undefined as ImportSummaryEntry | undefined;
const _importSummaryCheck: components['schemas']['ImportSummaryDto'] | undefined = undefined as
  | ImportSummary
  | undefined;
type _HighlightsFormatParam =
  operations['exportBookmarkHighlights']['parameters']['query']['format'];
const _highlightsFormatCheck: _HighlightsFormatParam | undefined = undefined as
  | HighlightsExportFormat
  | undefined;
void _exportDataCheck;
void _importSummaryEntryCheck;
void _importSummaryCheck;
void _highlightsFormatCheck;
