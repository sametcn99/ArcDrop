import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validationMetadatasToSchemas } from 'class-validator-jsonschema';

/** JSON Schema object as emitted by the generator. */
export type DtoJsonSchema = Record<string, unknown>;

const cache = new Map<string, DtoJsonSchema>();

/**
 * The JSON Schema for one DTO class (plan M7 parity contract). This is the
 * SAME metadata the REST ValidationPipe enforces — tool input schemas cannot
 * drift from REST validation because they are generated from it.
 *
 * The conversion scans the whole class-validator registry per call, so
 * results are cached per DTO name. A cache MISS regenerates (never caches a
 * miss): under bun all test files share one process and modules register
 * their decorators as they load, so a schema requested before some DTO
 * modules loaded must retry once they have.
 */
export function dtoSchema(dto: ClassConstructor<unknown>): DtoJsonSchema {
  const cached = cache.get(dto.name);
  if (cached !== undefined) return structuredClone(cached);
  const all = validationMetadatasToSchemas() as unknown as Record<string, DtoJsonSchema>;
  const schema = all[dto.name];
  if (!schema) {
    throw new Error(`No JSON schema could be generated for DTO ${dto.name}`);
  }
  cache.set(dto.name, schema);
  return structuredClone(schema);
}

/**
 * Merged input schema for tools whose REST operation takes more than one
 * DTO (path param + body, e.g. `PUT /bookmarks/{id}/tags`): the tool's
 * arguments object carries every part's properties flat.
 */
export function mergedDtoSchema(parts: Array<ClassConstructor<unknown>>): DtoJsonSchema {
  const properties: Record<string, DtoJsonSchema> = {};
  const required: string[] = [];
  for (const part of parts) {
    const schema = dtoSchema(part);
    Object.assign(properties, (schema['properties'] as Record<string, DtoJsonSchema>) ?? {});
    for (const name of (schema['required'] as string[]) ?? []) {
      if (!required.includes(name)) required.push(name);
    }
  }
  const merged: DtoJsonSchema = { type: 'object', properties };
  if (required.length > 0) merged['required'] = required;
  return merged;
}

/**
 * Turn plain tool arguments into DTO instances, one per part — the same
 * `plainToInstance` transform (including `@Type`/`@Transform` decorators)
 * the REST ValidationPipe applies before validation.
 */
export function toDtoInstances(dtos: Array<ClassConstructor<unknown>>, args: unknown): object[] {
  const source = (args ?? {}) as Record<string, unknown>;
  return dtos.map((dto) => plainToInstance(dto, source) as object);
}
