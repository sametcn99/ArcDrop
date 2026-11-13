import { createDataSource } from './data-source';
import { loadConfig } from '@api/config/load-config';

/**
 * TypeORM CLI entrypoint — bundled to `dist/data-source.cli.js` and consumed
 * as `bun node_modules/typeorm/cli.js migration:run -d dist/data-source.cli.js`
 * (see the `migration:*` scripts). Instantiates the DataSource at CLI
 * invocation time; importing this module has no side effects elsewhere.
 */
export default createDataSource(loadConfig());
