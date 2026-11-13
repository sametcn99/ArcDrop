import { InitialSetup1763000000000 } from './1763000000000-initial-setup';

/**
 * Migration registry — EXPLICIT list, same rule as `entities`: no globs
 * (they break under `bun build`). Every new migration file is added here.
 */
export const migrations = [InitialSetup1763000000000];
