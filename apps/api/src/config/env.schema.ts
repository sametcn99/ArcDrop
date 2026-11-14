import { z } from 'zod';

/**
 * Comma-separated string → trimmed string list.
 * Absent or empty → `[]` (CORS middleware is then not installed at all).
 */
const csvList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

/** `'true'`/`'false'` (case-insensitive, whitespace-tolerant) → boolean. */
const booleanFlag = (defaultValue: boolean) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
    z
      .union([z.literal('true').transform(() => true), z.literal('false').transform(() => false)])
      .default(defaultValue),
  );

/**
 * Environment schema (plan D8/M1). Variables use the `ARCDROP__` prefix with
 * double-underscore nesting; `strictObject` rejects unknown keys so typos like
 * `ARCDROP__DATABSE__URL` fail the boot instead of being ignored.
 * `loadConfig` fills absent object sections with `{}` before parsing so a
 * missing variable reports at its own name (e.g. `ARCDROP__DATABASE__URL`).
 */
export const envSchema = z.strictObject({
  database: z.strictObject({
    url: z
      .string()
      .min(1, 'is required')
      .refine(
        (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
        'must be a postgres:// or postgresql:// connection URL',
      ),
  }),
  jwt: z.strictObject({
    secret: z.string().min(32, 'must be at least 32 characters (use a long random value)'),
  }),
  port: z.coerce
    .number()
    .int('must be an integer')
    .min(1, 'must be ≥ 1')
    .max(65535, 'must be ≤ 65535')
    .default(3000),
  cors: z.strictObject({ origins: csvList }),
  dataDir: z.string().min(1, 'must not be empty').default('/data'),
  metrics: z.strictObject({ enabled: booleanFlag(false) }),
  metadata: z.strictObject({
    /** Master switch for the outbound metadata/icon fetch pipeline (M6). */
    enabled: booleanFlag(true),
    /**
     * TEST/DEV affordance only: allow the fetcher to target private/loopback
     * addresses for its INITIAL url. Redirect hops are ALWAYS validated
     * strictly. Never enable in production.
     */
    allowPrivate: booleanFlag(false),
  }),
  mcp: z.strictObject({
    /**
     * Per-PAT request budget (M7): requests a single personal access token
     * may make per minute, across REST and the MCP endpoint. Intentionally
     * ABOVE the global per-IP budget (100/min) so it only bites when one
     * token is used from many addresses — the stolen-token scenario.
     */
    patRequestsPerMinute: z.coerce.number().int().min(1).default(300),
  }),
  portability: z.strictObject({
    /**
     * M8 import size cap in bytes for a single uploaded file. ZIP archives
     * get their own, larger cap below (they unpack to many files at once).
     * Exceeding either is a `413` problem+json — enforced DURING the
     * streaming upload, never after buffering.
     */
    importMaxBytes: z.coerce.number().int().min(1).default(26_214_400), // 25 MiB
    importZipMaxBytes: z.coerce.number().int().min(1).default(314_572_800), // 300 MB
  }),
  rateLimit: z.strictObject({
    /**
     * M9/M13 per-user rate budgets on expensive routes (fixed 60s window).
     * Applied after authentication so multi-IP abuse of a single account
     * is bounded independently of the per-IP ThrottlerGuard.
     */
    importPerMinute: z.coerce.number().int().min(1).default(30),
    reindexPerMinute: z.coerce.number().int().min(1).default(30),
    mcpToolsPerMinute: z.coerce.number().int().min(1).default(300),
    bulkPerMinute: z.coerce.number().int().min(1).default(30),
  }),
  log: z.strictObject({
    level: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  }),
});

export type AppConfig = z.infer<typeof envSchema>;
export type LogLevel = AppConfig['log']['level'];
