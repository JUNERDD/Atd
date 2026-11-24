import type { TSchema } from 'typebox';
import type {
  ExtensionAPI,
  InlineExtension,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';

const JSON_TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);

/** Keywords whose values are schema maps, not schemas themselves. */
const SCHEMA_MAP_KEYS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
]);
/** Keywords whose values are arrays of schemas. */
const SCHEMA_ARRAY_KEYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
/** Keywords whose values are one schema (or a boolean schema). */
const SCHEMA_SINGLE_KEYS = new Set([
  'items',
  'additionalItems',
  'additionalProperties',
  'contains',
  'propertyNames',
  'if',
  'then',
  'else',
  'not',
  'unevaluatedItems',
  'unevaluatedProperties',
  'contentSchema',
]);
/** Keywords whose values are literal JSON data, never schemas. */
const LITERAL_KEYS = new Set(['const', 'enum', 'default', 'examples']);

/**
 * Moonshot's `walle` validator requires `type` on `enum` and `const` nodes, but rejects a
 * `type` beside `anyOf` / `oneOf`: each union branch must carry its own type. Normalize at the
 * provider boundary so the shared contracts stay unchanged and TypeBox's untyped enum nodes pass.
 */
export function normalizeToolSchema(schema: TSchema): TSchema {
  return normalizeSchema(schema) as TSchema;
}

/** Wrap an extension factory so every tool it registers gets a provider-safe schema. */
export function normalizeExtension(extension: InlineExtension): InlineExtension {
  const wrap = (factory: (pi: ExtensionAPI) => void | Promise<void>) => (pi: ExtensionAPI) =>
    factory(normalizeExtensionAPI(pi));
  return typeof extension === 'function'
    ? wrap(extension)
    : { ...extension, factory: wrap(extension.factory) };
}

/**
 * Wrap a raw extension API so every tool registered through it is normalized, including child
 * sessions that load their bridge without the parent's extension-factory list.
 */
export function normalizeExtensionAPI(pi: ExtensionAPI): ExtensionAPI {
  return new Proxy(pi, {
    get(target, property, receiver) {
      if (property === 'registerTool') {
        return (tool: ToolDefinition) =>
          target.registerTool({
            ...tool,
            parameters: normalizeToolSchema(tool.parameters),
          });
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function normalizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSchema);
  if (!isRecord(value)) return value;
  const entries: Array<[string, unknown]> = [];
  for (const [key, child] of Object.entries(value)) {
    if (LITERAL_KEYS.has(key)) {
      // Literal JSON data, never a schema: copy it through untouched.
      entries.push([key, child]);
    } else if (SCHEMA_MAP_KEYS.has(key)) {
      entries.push([key, isRecord(child) ? normalizeMap(child) : child]);
    } else if (key === 'dependencies') {
      entries.push([key, isRecord(child) ? normalizeDependencies(child) : child]);
    } else if (SCHEMA_ARRAY_KEYS.has(key)) {
      entries.push([key, Array.isArray(child) ? child.map(normalizeSchema) : child]);
    } else if (key === 'items' && Array.isArray(child)) {
      entries.push([key, child.map(normalizeSchema)]);
    } else if (SCHEMA_SINGLE_KEYS.has(key)) {
      entries.push([key, normalizeSchema(child)]);
    } else {
      entries.push([key, child]);
    }
  }
  const next = Object.fromEntries(entries) as Record<string, unknown>;
  if ('anyOf' in next || 'oneOf' in next) {
    // walle rejects a parent type beside a union; the branches already declare their types.
    delete next['type'];
    return next;
  }
  if (!('type' in next)) {
    const type = enumType(next);
    if (type !== undefined) next['type'] = type;
  }
  return next;
}

function normalizeMap(map: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(map).map(([name, schema]) => [name, normalizeSchema(schema)]),
  );
}

/** Draft-07 `dependencies`: an array of names or one schema per key. */
function normalizeDependencies(map: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(map).map(([name, dependency]) => [
      name,
      Array.isArray(dependency) ? dependency : normalizeSchema(dependency),
    ]),
  );
}

function enumType(schema: Record<string, unknown>): string | string[] | undefined {
  const values = schema['enum'];
  if (Array.isArray(values)) return collapse(typesOf(values));
  if ('const' in schema) return collapse(typesOf([schema['const']]));
  return undefined;
}

function collapse(types: readonly string[]): string | string[] | undefined {
  const unique = [...new Set(types)];
  if (!unique.length) return undefined;
  return unique.length === 1 ? unique[0] : unique;
}

function typesOf(values: readonly unknown[]): string[] {
  return [
    ...new Set(
      values.flatMap((value) => {
        if (Array.isArray(value)) return ['array'];
        if (value === null) return ['null'];
        const type = typeof value;
        return JSON_TYPES.has(type) ? [type] : [];
      }),
    ),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
