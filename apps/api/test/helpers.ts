import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Installs the environment the e2e boots run with (the production-faithful
 * config path — factories read `process.env` at DI time). Only
 * `ARCDROP__DATABASE__URL` must come from outside (CI pre-wires exactly that
 * variable); everything else gets a deterministic test value.
 */
export function installTestEnv(): void {
  process.env.ARCDROP__DATABASE__URL ||= 'postgres://arcdrop:arcdrop@localhost:5432/arcdrop_test';
  process.env.ARCDROP__JWT__SECRET ||= 'e2e-test-secret-0123456789abcdef0123456789abcdef';
  process.env.ARCDROP__DATA_DIR ||= mkdtempSync(join(tmpdir(), 'arcdrop-e2e-data-'));
  process.env.ARCDROP__LOG__LEVEL ||= 'warn';
  // M6: the outbound fetch pipeline is DISABLED for every suite except the
  // metadata one — it would otherwise try to scrape real public URLs
  // mid-test (slow, network-dependent) and inject `bookmark:update` events
  // that break the exact-seq sync assertions. The metadata suite sets these
  // to `true` BEFORE calling installTestEnv for its own boots and restores
  // them in afterAll.
  process.env.ARCDROP__METADATA__ENABLED ||= 'false';
  process.env.ARCDROP__METADATA__ALLOW_PRIVATE ||= 'false';
}
