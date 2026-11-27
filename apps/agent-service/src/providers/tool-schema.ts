import type { TSchema } from 'typebox';
import type {
  ExtensionAPI,
  InlineExtension,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';

const JSON_TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);
const NULLABLE_SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean']);
const UNION_ANNOTATION_KEYS = new Set([
  'title',
  'description',
  'default',
  'examples',
  '$comment',
  'deprecated',
  'readOnly',
  'writeOnly',
]);

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
 * Moonshot's `walle` validator requires explicit `type` on `enum` and `const` nodes (single type or
 * nullable scalar pair) and rejects a redundant parent `type` on pure non-root `anyOf` / `oneOf`
 * unions. Root `type` and conjunctive `type` constraints are preserved for providers and `pi-schema`.
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

function normalizeSchema(value: unknown, isRoot = true): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeSchema(item, false));
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
      entries.push([
        key,
        Array.isArray(child) ? child.map((item) => normalizeSchema(item, false)) : child,
      ]);
    } else if (key === 'items' && Array.isArray(child)) {
      entries.push([key, child.map((item) => normalizeSchema(item, false))]);
    } else if (SCHEMA_SINGLE_KEYS.has(key)) {
      entries.push([key, normalizeSchema(child, false)]);
    } else {
      entries.push([key, child]);
    }
  }
  const next = Object.fromEntries(entries) as Record<string, unknown>;
  if ('anyOf' in next || 'oneOf' in next) {
    if (!isRoot && 'type' in next && isRedundantUnionType(next)) {
      // walle rejects a redundant parent type beside a pure union when every branch is subsumed.
      delete next['type'];
    }
    return next;
  }
  if (!('type' in next)) {
    const type = enumType(next);
    if (type !== undefined) next['type'] = type;
  }
  return next;
}

function isRedundantUnionType(schema: Record<string, unknown>): boolean {
  for (const key of Object.keys(schema)) {
    if (key !== 'type' && key !== 'anyOf' && key !== 'oneOf' && !UNION_ANNOTATION_KEYS.has(key)) {
      return false;
    }
  }
  const parentTypes = validJsonTypes(schema['type']);
  if (!parentTypes) return false;
  for (const key of ['anyOf', 'oneOf'] as const) {
    if (!(key in schema)) continue;
    const branches = schema[key];
    if (!Array.isArray(branches) || branches.length === 0) return false;
    if (
      !branches.every((branch) => {
        if (!isRecord(branch)) return false;
        const branchTypes = validJsonTypes(branch['type']);
        return branchTypes !== null && isSubsumedBy(branchTypes, parentTypes);
      })
    ) {
      return false;
    }
  }
  return true;
}

function validJsonTypes(value: unknown): Set<string> | null {
  if (typeof value === 'string') return JSON_TYPES.has(value) ? new Set([value]) : null;
  if (!Array.isArray(value) || value.length === 0) return null;
  const types = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !JSON_TYPES.has(entry)) return null;
    types.add(entry);
  }
  return types;
}

function isSubsumedBy(branchTypes: Set<string>, parentTypes: Set<string>): boolean {
  for (const type of branchTypes) {
    if (!parentTypes.has(type) && !(type === 'integer' && parentTypes.has('number'))) {
      return false;
    }
  }
  return true;
}

function normalizeMap(map: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(map).map(([name, schema]) => [name, normalizeSchema(schema, false)]),
  );
}

/** Draft-07 `dependencies`: an array of names or one schema per key. */
function normalizeDependencies(map: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(map).map(([name, dependency]) => [
      name,
      Array.isArray(dependency) ? dependency : normalizeSchema(dependency, false),
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
  if (unique.length === 1) return unique[0];
  if (
    unique.length === 2 &&
    unique.includes('null') &&
    unique.some((type) => NULLABLE_SCALAR_TYPES.has(type))
  ) {
    return unique;
  }
  return undefined;
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
