import { describe, expect, it } from 'bun:test';
import { collectEnv, envVarName, ENV_PREFIX } from './env.loader';
import { ConfigValidationError, loadConfig } from './load-config';

const baseEnv: Record<string, string> = {
  ARCDROP__DATABASE__URL: 'postgres://arcdrop:arcdrop@localhost:5432/arcdrop_test',
  ARCDROP__JWT__SECRET: 'unit-test-secret-0123456789abcdef',
};

describe('collectEnv', () => {
  it('nests double-underscore keys and camelCases snake segments', () => {
    const collected = collectEnv({
      ARCDROP__DATABASE__URL: 'postgres://example',
      ARCDROP__DATA_DIR: '/tmp/x',
      ARCDROP__METRICS__ENABLED: 'true',
      UNRELATED: 'ignored',
    });
    expect(collected).toEqual({
      database: { url: 'postgres://example' },
      dataDir: '/tmp/x',
      metrics: { enabled: 'true' },
    });
  });

  it('renders zod paths back to env-var names', () => {
    expect(envVarName(['database', 'url'])).toBe('ARCDROP__DATABASE__URL');
    expect(envVarName(['dataDir'])).toBe('ARCDROP__DATA_DIR');
  });
});

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const config = loadConfig(baseEnv);
    expect(config.database.url).toBe('postgres://arcdrop:arcdrop@localhost:5432/arcdrop_test');
    expect(config.jwt.secret).toBe('unit-test-secret-0123456789abcdef');
    expect(config.port).toBe(3000);
    expect(config.dataDir).toBe('/data');
    expect(config.metrics.enabled).toBe(false);
    expect(config.cors.origins).toEqual([]);
    expect(config.rateLimit).toEqual({
      importPerMinute: 30,
      reindexPerMinute: 30,
      mcpToolsPerMinute: 300,
      bulkPerMinute: 30,
    });
    expect(config.log.level).toBe('info');
  });

  it('parses and coerces provided values', () => {
    const config = loadConfig({
      ...baseEnv,
      ARCDROP__PORT: '8080',
      ARCDROP__CORS__ORIGINS: 'https://a.example , https://b.example,,',
      ARCDROP__DATA_DIR: '/var/arcdrop',
      ARCDROP__METRICS__ENABLED: 'TRUE',
      ARCDROP__RATE_LIMIT__IMPORT_PER_MINUTE: '15',
      ARCDROP__LOG__LEVEL: 'debug',
    });
    expect(config.port).toBe(8080);
    expect(config.cors.origins).toEqual(['https://a.example', 'https://b.example']);
    expect(config.dataDir).toBe('/var/arcdrop');
    expect(config.metrics.enabled).toBe(true);
    expect(config.rateLimit.importPerMinute).toBe(15);
    expect(config.log.level).toBe('debug');
  });

  it('rejects a missing database URL, naming the env var', () => {
    let error: unknown;
    try {
      loadConfig({ ARCDROP__JWT__SECRET: baseEnv['ARCDROP__JWT__SECRET']! });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigValidationError);
    const issues = (error as ConfigValidationError).issues;
    expect(issues.some((issue) => issue.startsWith('ARCDROP__DATABASE__URL'))).toBe(true);
  });

  it('rejects a non-postgres database URL', () => {
    let issues: readonly string[] = [];
    try {
      loadConfig({ ...baseEnv, ARCDROP__DATABASE__URL: 'mysql://arcdrop@localhost/arcdrop' });
    } catch (e) {
      issues = (e as ConfigValidationError).issues;
    }
    expect(issues.some((issue) => issue.includes('postgres://'))).toBe(true);
  });

  it('rejects a short JWT secret', () => {
    let issues: readonly string[] = [];
    try {
      loadConfig({ ...baseEnv, ARCDROP__JWT__SECRET: 'too-short' });
    } catch (e) {
      issues = (e as ConfigValidationError).issues;
    }
    expect(issues.some((issue) => issue.startsWith('ARCDROP__JWT__SECRET'))).toBe(true);
  });

  it('rejects a non-numeric port', () => {
    let issues: readonly string[] = [];
    try {
      loadConfig({ ...baseEnv, ARCDROP__PORT: 'not-a-number' });
    } catch (e) {
      issues = (e as ConfigValidationError).issues;
    }
    expect(issues.some((issue) => issue.startsWith('ARCDROP__PORT'))).toBe(true);
  });

  it('rejects unknown ARCDROP__ keys (typo protection)', () => {
    let issues: readonly string[] = [];
    try {
      loadConfig({ ...baseEnv, ARCDROP__DATABSE__URL: 'postgres://typo' });
    } catch (e) {
      issues = (e as ConfigValidationError).issues;
    }
    expect(issues.some((issue) => issue.startsWith('ARCDROP__DATABSE'))).toBe(true);
  });

  it('ignores variables without the prefix', () => {
    const config = loadConfig({ ...baseEnv, PORT: '1234', JWT_SECRET: 'nope' });
    expect(config.port).toBe(3000);
  });

  it('exposes the configured prefix constant', () => {
    expect(ENV_PREFIX).toBe('ARCDROP__');
  });
});
