import { InitialSetup1763000000000 } from './1763000000000-initial-setup';
import { M2AuthUsers1794606603617 } from './1794606603617-M2AuthUsers';

/**
 * Migration registry — EXPLICIT list, same rule as `entities`: no globs
 * (they break under `bun build`). Every new migration file is added here.
 */
export const migrations = [InitialSetup1763000000000, M2AuthUsers1794606603617];
