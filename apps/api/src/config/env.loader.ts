/**
 * Reads every `ARCDROP__*` environment variable and folds it into a nested
 * plain object: `ARCDROP__DATABASE__URL` becomes `{ database: { url } }`.
 *
 * Segment mapping rule: lowercase, then `snake_case` → `camelCase`
 * (`DATA_DIR` → `dataDir`, `URL` → `url`). Nested objects are only created
 * for intermediate segments; leaves keep the raw string value (zod coerces).
 */
export const ENV_PREFIX = 'ARCDROP__';

export function collectEnv(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const root: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(ENV_PREFIX)) continue;

    const segments = key
      .slice(ENV_PREFIX.length)
      .split('__')
      .filter((segment) => segment.length > 0);
    if (segments.length === 0) continue;

    let cursor = root;
    segments.forEach((segment, index) => {
      const name = segment
        .toLowerCase()
        .replaceAll(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());

      if (index === segments.length - 1) {
        cursor[name] = value;
        return;
      }

      const existing = cursor[name];
      const branch =
        typeof existing === 'object' && existing !== null
          ? (existing as Record<string, unknown>)
          : {};
      cursor[name] = branch;
      cursor = branch;
    });
  }

  return root;
}

/** Renders a zod issue path back into its `ARCDROP__SNAKE_CASE` env-var name. */
export function envVarName(path: readonly PropertyKey[]): string {
  const segments = path.map((part) =>
    String(part)
      .replaceAll(/[A-Z]/g, (char) => `_${char}`)
      .toUpperCase(),
  );
  return ENV_PREFIX + segments.join('__');
}
