import type { ZodError } from 'zod';
import { envSchema } from './env.schema';
import type { AppConfig } from './env.schema';
import { collectEnv, envVarName } from './env.loader';

/**
 * Thrown by `loadConfig` when the environment fails zod validation.
 * `issues` are pre-formatted, one line per problem, using the original
 * `ARCDROP__*` variable names so the boot report is actionable.
 */
export class ConfigValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid environment configuration (${issues.length} issue${issues.length === 1 ? '' : 's'})`,
    );
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

function formatIssues(error: ZodError): string[] {
  const lines: string[] = [];
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      const keys = (issue as unknown as { keys?: unknown }).keys;
      if (Array.isArray(keys)) {
        for (const key of keys) {
          lines.push(
            `${envVarName([...issue.path, String(key)])} — unrecognized variable (check for typos)`,
          );
        }
        continue;
      }
    }
    lines.push(`${envVarName(issue.path)} — ${issue.message}`);
  }
  return lines;
}

/**
 * Collects `ARCDROP__*` variables from `env` (default: `process.env`), nests
 * them, and validates against the zod schema. Pure and synchronous — call it
 * before anything else at boot (fail-fast) and anywhere config is needed.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const collected = collectEnv(env);
  // Fill absent object sections so their inner field issues surface precisely
  // (a missing `ARCDROP__DATABASE__URL` reports at `DATABASE__URL`, not as
  // "expected object" on the whole section).
  for (const section of [
    'database',
    'jwt',
    'cors',
    'metrics',
    'metadata',
    'mcp',
    'portability',
    'rateLimit',
    'log',
  ]) {
    if (collected[section] === undefined) collected[section] = {};
  }
  const parsed = envSchema.safeParse(collected);
  if (!parsed.success) {
    throw new ConfigValidationError(formatIssues(parsed.error));
  }
  return parsed.data;
}
