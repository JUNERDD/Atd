import type { TSchema } from 'typebox';
import type {
  ExtensionAPI,
  InlineExtension,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';

/**
 * Some OpenAI-compatible providers (notably Moonshot) require every enum/union node to declare
 * its type. TypeBox emits `enum` and `anyOf` without one. Normalize at the provider boundary so
 * the shared contracts stay unchanged and every model receives a standards-compliant schema.
 */
export function normalizeToolSchema(schema: TSchema): TSchema {
  return normalizeNode(schema) as TSchema;
}

/** Wrap an extension factory so every tool it registers gets a provider-safe schema. */
export function normalizeExtension(extension: InlineExtension): InlineExtension {
  const wrap = (factory: (pi: ExtensionAPI) => void | Promise<void>) => (pi: ExtensionAPI) =>
    factory(withNormalizedRegisterTool(pi));
  return typeof extension === 'function'
    ? wrap(extension)
    : { ...extension, factory: wrap(extension.factory) };
}

function withNormalizedRegisterTool(pi: ExtensionAPI): ExtensionAPI {
  return new Proxy(pi, {
    get(target, property, receiver) {
      if (property === 'registerTool') {
        return (tool: ToolDefinition) =>
          target.registerTool({
            ...tool,
            parameters: normalizeNode(tool.parameters) as TSchema,
          });
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

const JSON_TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'string']);

function normalizeNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeNode);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) next[key] = normalizeNode(child);
  if (!('type' in next)) {
    const type = schemaType(next);
    if (type !== undefined) next['type'] = type;
  }
  return next;
}

function schemaType(schema: Record<string, unknown>): string | string[] | undefined {
  const values = schema['enum'];
  if (Array.isArray(values)) {
    const type = typesOf(values);
    return type.length === 1 ? type[0] : type.length ? type : undefined;
  }
  if ('const' in schema) {
    const type = typesOf([schema['const']]);
    return type.length === 1 ? type[0] : type.length ? type : undefined;
  }
  const branches = schema['anyOf'] ?? schema['oneOf'];
  if (!Array.isArray(branches)) return undefined;
  const type = [
    ...new Set(
      branches.flatMap((branch) => {
        if (!branch || typeof branch !== 'object') return [];
        const value = (branch as Record<string, unknown>)['type'];
        return Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : typeof value === 'string'
            ? [value]
            : [];
      }),
    ),
  ];
  return type.length === 1 ? type[0] : type.length ? type : undefined;
}

function typesOf(values: readonly unknown[]): string[] {
  return [
    ...new Set(
      values.flatMap((value) => {
        if (Array.isArray(value)) return value;
        if (value === null) return ['null'];
        const type = typeof value;
        return JSON_TYPES.has(type) ? [type] : [];
      }),
    ),
  ];
}
