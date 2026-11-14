import { InitialSetup1763000000000 } from './1763000000000-initial-setup';
import { M2AuthUsers1794606603617 } from './1794606603617-M2AuthUsers';
import { M3BookmarksCore1794608754948 } from './1794608754948-M3BookmarksCore';
import { M4Collections1794611852359 } from './1794611852359-M4Collections';
import { M7TokensAudit1794619559850 } from './1794619559850-M7TokensAudit';

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
];
