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

/** `'true'`/`'false'` (case-insensitive, whitespace-tolerant) → boolean, absent → `false`. */
const booleanFlag = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z
    .union([z.literal('true').transform(() => true), z.literal('false').transform(() => false)])
    .default(false),
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
  metrics: z.strictObject({ enabled: booleanFlag }),
  log: z.strictObject({
    level: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  }),
});

export type AppConfig = z.infer<typeof envSchema>;
export type LogLevel = AppConfig['log']['level'];
