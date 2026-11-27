import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Type, type TSchema } from 'typebox';
import { validateToolArguments } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { CommandToolParametersSchema } from '../dist/commands/tool.js';
import { ComputerToolParametersSchema } from '../dist/computer/calls.js';
import {
  normalizeExtension,
  normalizeExtensionAPI,
  normalizeToolSchema,
} from '../dist/providers/tool-schema.js';

const JSON_TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);
const SCHEMA_MAP_KEYS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
]);
const SCHEMA_ARRAY_KEYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
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
const LITERAL_KEYS = new Set(['const', 'enum', 'default', 'examples']);
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

function property(schema: TSchema, name: string): Record<string, unknown> {
  const properties = Reflect.get(schema, 'properties');
  assert.ok(properties && typeof properties === 'object');
  const value = Reflect.get(properties, name);
  assert.ok(value && typeof value === 'object');
  return value as Record<string, unknown>;
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

function isPureTypedUnion(schema: Record<string, unknown>): boolean {
  const pureKeys = Object.keys(schema).every(
    (key) => key === 'type' || key === 'anyOf' || key === 'oneOf' || UNION_ANNOTATION_KEYS.has(key),
  );
  if (!pureKeys) return false;
  const parentTypes = validJsonTypes(schema['type']);
  if (!parentTypes) return false;
  for (const key of ['anyOf', 'oneOf'] as const) {
    if (!(key in schema)) continue;
    const branches = schema[key];
    if (!Array.isArray(branches) || !branches.length) return false;
    for (const branch of branches) {
      if (!branch || typeof branch !== 'object' || Array.isArray(branch)) return false;
      const branchTypes = validJsonTypes((branch as Record<string, unknown>)['type']);
      if (
        !branchTypes ||
        ![...branchTypes].every(
          (type) => parentTypes.has(type) || (type === 'integer' && parentTypes.has('number')),
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

/** Root schemas declare `type: "object"`; pure non-root unions omit redundant `type`; enum/const declare `type`. */
function assertProviderSafe(value: unknown, path = ''): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertProviderSafe(child, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const schema = value as Record<string, unknown>;
  const isRoot = path === '';
  if (isRoot) assert.equal(schema['type'], 'object', 'tool root must declare type: "object"');
  const union = 'anyOf' in schema || 'oneOf' in schema;
  if (!isRoot && union && 'type' in schema && isPureTypedUnion(schema))
    assert.fail(`pure union parent declares redundant type at ${path}`);
  if (!union && ('enum' in schema || 'const' in schema) && !('type' in schema))
    assert.fail(`missing type at ${path || '<root>'}`);
  for (const [key, child] of Object.entries(schema)) {
    if (LITERAL_KEYS.has(key)) continue;
    const childPath = path ? `${path}.${key}` : key;
    if (SCHEMA_MAP_KEYS.has(key)) {
      if (child && typeof child === 'object' && !Array.isArray(child))
        for (const [name, subschema] of Object.entries(child))
          assertProviderSafe(subschema, `${childPath}.${name}`);
    } else if (key === 'dependencies') {
      if (child && typeof child === 'object' && !Array.isArray(child))
        for (const [name, dependency] of Object.entries(child))
          if (!Array.isArray(dependency)) assertProviderSafe(dependency, `${childPath}.${name}`);
    } else if (SCHEMA_ARRAY_KEYS.has(key)) {
      if (Array.isArray(child))
        child.forEach((branch, index) => assertProviderSafe(branch, `${childPath}[${index}]`));
    } else if (key === 'items' && Array.isArray(child)) {
      child.forEach((item, index) => assertProviderSafe(item, `${childPath}[${index}]`));
    } else if (SCHEMA_SINGLE_KEYS.has(key)) {
      assertProviderSafe(child, childPath);
    }
  }
}

function makeTool(name: string, parameters: TSchema): ToolDefinition {
  return {
    name,
    label: name,
    description: 'Test tool',
    parameters,
    execute: async () => ({ content: [], details: undefined }),
  };
}

function callArgs(tool: ToolDefinition, args: unknown): unknown {
  return validateToolArguments(tool, {
    type: 'toolCall',
    id: 'call-1',
    name: tool.name,
    arguments: args as never,
  });
}

function captureTool(register: (pi: ExtensionAPI) => void): ToolDefinition {
  let registered: ToolDefinition | undefined;
  register({
    registerTool: (next: ToolDefinition) => {
      registered = next;
    },
  } as unknown as ExtensionAPI);
  assert.ok(registered);
  return registered;
}

function assertUnionBranchesTyped(schema: TSchema, name: string): void {
  const union = property(schema, name);
  assert.equal('type' in union, false, `${name} must not declare a parent type`);
  const branches = union['anyOf'] ?? union['oneOf'];
  assert.ok(Array.isArray(branches));
  for (const branch of branches) {
    assert.ok(branch && typeof branch === 'object');
    assert.ok('type' in branch || '$ref' in branch, `${name} branch must declare type or $ref`);
  }
}

test('enum and const nodes declare their type, unions do not', () => {
  const schema = Type.Object({
    action: Type.Union([Type.Literal('observe'), Type.Literal('act')]),
    key: Type.Enum(['a', 'b']),
    mixed: Type.Union([Type.Literal('text'), Type.Null()]),
    count: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  });
  const normalized = normalizeToolSchema(schema);
  assert.equal(property(normalized, 'key')['type'], 'string');
  assertUnionBranchesTyped(normalized, 'action');
  assertUnionBranchesTyped(normalized, 'mixed');
  assertUnionBranchesTyped(normalized, 'count');
  assert.deepEqual(
    (property(normalized, 'count')['anyOf'] as Array<Record<string, unknown>>).map(
      (branch) => branch['type'],
    ),
    ['integer', 'null'],
  );
  assert.equal(property(schema, 'action')['type'], undefined);
});

test('the real command tool schema keeps its revision union branches typed', () => {
  const normalized = normalizeToolSchema(CommandToolParametersSchema);
  assertUnionBranchesTyped(normalized, 'expectedRevision');
  assert.deepEqual(
    (property(normalized, 'expectedRevision')['anyOf'] as Array<Record<string, unknown>>).map(
      (branch) => branch['type'],
    ),
    ['integer', 'null'],
  );
});

test('the real computer tool schema is provider safe', () => {
  const normalized = normalizeToolSchema(ComputerToolParametersSchema);
  assert.equal(Reflect.get(normalized, 'type'), 'object');
  assertProviderSafe(normalized);
  assertUnionBranchesTyped(normalized, 'action');
});

test('normalized schemas validate through Pi and reject non-object computer arguments', () => {
  const tool = makeTool('computer', normalizeToolSchema(ComputerToolParametersSchema));
  assert.deepEqual(callArgs(tool, { action: 'status', completion: null }), {
    action: 'status',
    completion: null,
  });
  for (const invalid of [42, 'hello', [], true]) {
    assert.throws(() => callArgs(tool, invalid));
  }
});

test('extension and API wrappers normalize registered tool schemas', () => {
  const raw = {
    type: 'object',
    properties: {
      mode: { enum: ['a', 'b'] },
      action: { type: 'string', anyOf: [{ const: 'a' }, { const: 'b' }] },
    },
  } as unknown as TSchema;
  assert.equal('type' in property(raw, 'mode'), false);
  assert.equal(property(raw, 'action')['type'], 'string');
  const tool = makeTool('computer', raw);

  const assertNormalized = (registered: ToolDefinition): void => {
    assert.equal(property(registered.parameters, 'mode')['type'], 'string');
    assertUnionBranchesTyped(registered.parameters, 'action');
    assert.deepEqual(
      (property(registered.parameters, 'action')['anyOf'] as Array<Record<string, unknown>>).map(
        (branch) => branch['type'],
      ),
      ['string', 'string'],
    );
  };

  const fnExtension = normalizeExtension((api) => api.registerTool(tool));
  assert.equal(typeof fnExtension, 'function');
  assertNormalized(
    captureTool((pi) => {
      if (typeof fnExtension === 'function') fnExtension(pi);
    }),
  );

  const objExtension = normalizeExtension({
    name: 'inline-tool-schema',
    hidden: true,
    factory: (api) => api.registerTool(tool),
  });
  if (typeof objExtension === 'function') assert.fail('expected object InlineExtension');
  assert.equal(objExtension.name, 'inline-tool-schema');
  assert.equal(objExtension.hidden, true);
  assertNormalized(
    captureTool((pi) => {
      void objExtension.factory(pi);
    }),
  );

  assertNormalized(captureTool((pi) => normalizeExtensionAPI(pi).registerTool(tool)));
  assert.equal('type' in property(raw, 'mode'), false);
  assert.equal(property(raw, 'action')['type'], 'string');
});

test('assertProviderSafe distinguishes redundant and narrowing union parent types', () => {
  assertProviderSafe(
    normalizeToolSchema({
      type: 'object',
      properties: { v: { type: 'string', anyOf: [{ type: 'string' }, { type: 'object' }] } },
    } as unknown as TSchema),
  );
  assert.throws(() =>
    assertProviderSafe({
      type: 'object',
      properties: { v: { type: 'number', anyOf: [{ type: 'integer' }, { type: 'integer' }] } },
    }),
  );
});

test('schema maps and literal payloads are not rewritten as schemas', () => {
  const normalized = normalizeToolSchema({
    type: 'object',
    properties: {
      const: { type: 'string' },
      name: { type: 'string' },
      payload: { const: { const: 'x' } },
    },
    dependencies: { enum: ['other'] },
  } as unknown as TSchema);
  const properties = Reflect.get(normalized, 'properties') as Record<string, unknown>;
  const dependencies = Reflect.get(normalized, 'dependencies') as Record<string, unknown>;
  assert.equal('type' in properties, false);
  assert.equal('type' in dependencies, false);
  assert.deepEqual((properties['payload'] as Record<string, unknown>)['const'], { const: 'x' });
});

test('array constants and enum literals declare the array type', () => {
  const normalized = normalizeToolSchema({
    type: 'object',
    properties: {
      tuple: { const: [1, 2] },
      choices: { enum: [['a'], ['b']] },
      empty: { const: [] },
      words: { const: ['string'] },
    },
  } as unknown as TSchema);
  for (const name of ['tuple', 'choices', 'empty', 'words']) {
    assert.equal(property(normalized, name)['type'], 'array');
  }
  assert.deepEqual(property(normalized, 'tuple')['const'], [1, 2]);
  assert.deepEqual(property(normalized, 'choices')['enum'], [['a'], ['b']]);
});

test('heterogeneous enums omit multi-type arrays while nullable scalars stamp pair', () => {
  const normalized = normalizeToolSchema({
    type: 'object',
    properties: {
      mixed: { enum: ['auto', 0] },
      triple: { enum: ['a', 0, null] },
      arrayOrNull: { enum: [[], null] },
      objectOrNull: { enum: [{}, null] },
      nullableText: { enum: ['a', null] },
    },
  } as unknown as TSchema);
  for (const name of ['mixed', 'triple', 'arrayOrNull', 'objectOrNull']) {
    assert.equal('type' in property(normalized, name), false, `${name} must omit type`);
  }
  assert.deepEqual(property(normalized, 'nullableText')['type'], ['string', 'null']);
});
