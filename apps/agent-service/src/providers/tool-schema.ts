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
 * Some OpenAI-compatible providers (notably Moonshot) require every enum/union node to declare
 * its type. TypeBox emits `enum` and `anyOf` without one. Normalize at the provider boundary so
 * the shared contracts stay unchanged and every model receives a standards-compliant schema.
 */
export function normalizeToolSchema(schema: TSchema): TSchema {
  return normalizeSchema(schema, schema) as TSchema;
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

function normalizeSchema(
  value: unknown,
  root: unknown,
  seen: ReadonlySet<string> = new Set(),
): unknown {
  if (Array.isArray(value)) return value.map((child) => normalizeSchema(child, root, seen));
  if (!isRecord(value)) return value;
  const entries: Array<[string, unknown]> = [];
  for (const [key, child] of Object.entries(value)) {
    if (LITERAL_KEYS.has(key)) {
      // Literal JSON data, never a schema: copy it through untouched.
      entries.push([key, child]);
    } else if (SCHEMA_MAP_KEYS.has(key)) {
      entries.push([key, isRecord(child) ? normalizeMap(child, root, seen) : child]);
    } else if (key === 'dependencies') {
      entries.push([key, isRecord(child) ? normalizeDependencies(child, root, seen) : child]);
    } else if (SCHEMA_ARRAY_KEYS.has(key)) {
      entries.push([
        key,
        Array.isArray(child) ? child.map((branch) => normalizeSchema(branch, root, seen)) : child,
      ]);
    } else if (key === 'items' && Array.isArray(child)) {
      entries.push([key, child.map((item) => normalizeSchema(item, root, seen))]);
    } else if (SCHEMA_SINGLE_KEYS.has(key)) {
      entries.push([key, normalizeSchema(child, root, seen)]);
    } else {
      entries.push([key, child]);
    }
  }
  const next = Object.fromEntries(entries) as Record<string, unknown>;
  if (!('type' in next)) {
    const type = schemaType(next, root, seen);
    if (type !== undefined) next['type'] = type;
  }
  return next;
}

function normalizeMap(
  map: Record<string, unknown>,
  root: unknown,
  seen: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(map).map(([name, schema]) => [name, normalizeSchema(schema, root, seen)]),
  );
}

/** Draft-07 `dependencies`: an array of names or one schema per key. */
function normalizeDependencies(
  map: Record<string, unknown>,
  root: unknown,
  seen: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(map).map(([name, dependency]) => [
      name,
      Array.isArray(dependency) ? dependency : normalizeSchema(dependency, root, seen),
    ]),
  );
}

function schemaType(
  schema: Record<string, unknown>,
  root: unknown,
  seen: ReadonlySet<string>,
): string | string[] | undefined {
  const values = schema['enum'];
  if (Array.isArray(values)) return collapse(typesOf(values));
  if ('const' in schema) return collapse(typesOf([schema['const']]));
  const branches = schema['anyOf'] ?? schema['oneOf'];
  if (!Array.isArray(branches)) return undefined;
  const types: string[] = [];
  for (const branch of branches) {
    const branchTypes = branchType(branch, root, seen);
    if (!branchTypes) return undefined;
    types.push(...branchTypes);
  }
  return collapse(types);
}

/**
 * A union may only declare a type when every branch has one. `$ref` branches resolve through
 * local `#/...` pointers; an untyped branch leaves the whole union untyped, which validation
 * treats as the union itself instead of a narrower intersection.
 */
function branchType(
  branch: unknown,
  root: unknown,
  seen: ReadonlySet<string>,
): string[] | undefined {
  if (!isRecord(branch)) return undefined;
  const declared = declaredTypes(branch['type']);
  if (declared) return declared;
  const ref = branch['$ref'];
  if (typeof ref === 'string' && ref.startsWith('#/')) {
    if (seen.has(ref)) return undefined;
    const target = resolveRef(root, ref);
    if (!isRecord(target)) return undefined;
    const declaredTarget = declaredTypes(target['type']);
    if (declaredTarget) return declaredTarget;
    const type = schemaType(target, root, new Set([...seen, ref]));
    if (type === undefined) return undefined;
    return Array.isArray(type) ? type : [type];
  }
  const nested = schemaType(branch, root, seen);
  if (nested === undefined) return undefined;
  return Array.isArray(nested) ? nested : [nested];
}

function declaredTypes(value: unknown): string[] | undefined {
  if (typeof value === 'string') return JSON_TYPES.has(value) ? [value] : undefined;
  if (!Array.isArray(value) || !value.length) return undefined;
  if (!value.every((item): item is string => typeof item === 'string' && JSON_TYPES.has(item)))
    return undefined;
  return [...new Set(value)];
}

function resolveRef(root: unknown, ref: string): unknown {
  const segments = ref
    .slice(2)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
    } else if (isRecord(current)) {
      if (!(segment in current)) return undefined;
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
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
