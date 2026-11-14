import { InitialSetup1763000000000 } from './1763000000000-initial-setup';
import { M2AuthUsers1794606603617 } from './1794606603617-M2AuthUsers';
import { M3BookmarksCore1794608754948 } from './1794608754948-M3BookmarksCore';
import { M4Collections1794611852359 } from './1794611852359-M4Collections';
import { M7TokensAudit1794619559850 } from './1794619559850-M7TokensAudit';
import { M10BookmarkEnrichment1794626882385 } from './1794626882385-M10BookmarkEnrichment';
import { M12LibraryHealth1794629705566 } from './1794629705566-M12LibraryHealth';
import { M14RemindersNotifications1794632472998 } from './1794632472998-M14RemindersNotifications';
import { M15TwoFactorAuth1794633718696 } from './1794633718696-M15TwoFactorAuth';
import { M16ManualOrdering1794634989570 } from './1794634989570-M16ManualOrdering';
import { M17ArchiveFullTextSearch1794636418427 } from './1794636418427-M17ArchiveFullTextSearch';

/**
 * Migration registry — EXPLICIT list, same rule as `entities`: no globs
 * (they break under `bun build`). Every new migration file is added here.
 */
export const migrations = [
  InitialSetup1763000000000,
  M2AuthUsers1794606603617,
  M3BookmarksCore1794608754948,
  M4Collections1794611852359,
  M7TokensAudit1794619559850,
  M10BookmarkEnrichment1794626882385,
  M12LibraryHealth1794629705566,
  M14RemindersNotifications1794632472998,
  M15TwoFactorAuth1794633718696,
  M16ManualOrdering1794634989570,
  M17ArchiveFullTextSearch1794636418427,
];
