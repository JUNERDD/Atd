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

function property(schema: TSchema, name: string): Record<string, unknown> {
  const properties = Reflect.get(schema, 'properties');
  assert.ok(properties && typeof properties === 'object');
  const value = Reflect.get(properties, name);
  assert.ok(value && typeof value === 'object');
  return value as Record<string, unknown>;
}

/** walle requires `type` on enum/const nodes and forbids it beside anyOf/oneOf. */
function assertProviderSafe(value: unknown, path = ''): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertProviderSafe(child, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const schema = value as Record<string, unknown>;
  const union = 'anyOf' in schema || 'oneOf' in schema;
  if (union && 'type' in schema) assert.fail(`union parent declares type at ${path || '<root>'}`);
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
  assertProviderSafe(normalized);
  assertUnionBranchesTyped(normalized, 'action');
});

test('normalized schemas validate through Pi without TypeBox markers', () => {
  const tool = {
    name: 'computer',
    label: 'Computer',
    description: 'Test tool',
    parameters: normalizeToolSchema(ComputerToolParametersSchema),
    execute: async () => ({ content: [], details: undefined }),
  } as ToolDefinition;
  const args = validateToolArguments(tool, {
    type: 'toolCall',
    id: 'call-1',
    name: 'computer',
    arguments: { action: 'status', completion: null },
  });
  assert.deepEqual(args, { action: 'status', completion: null });
});

test('normalization is provider independent', () => {
  const schema = Type.Object({ value: Type.Union([Type.Literal('a'), Type.Literal('b')]) });
  const normalized = normalizeToolSchema(schema);
  assert.equal('type' in property(normalized, 'value'), false);
});

test('extension registration normalizes the schema for Moonshot', () => {
  const tool: ToolDefinition = {
    name: 'computer',
    label: 'Computer',
    description: 'Test tool',
    parameters: Type.Object({ action: Type.Union([Type.Literal('a'), Type.Literal('b')]) }),
    execute: async () => ({ content: [], details: undefined }),
  };
  let registered: ToolDefinition | undefined;
  const pi = {
    registerTool: (next: ToolDefinition) => {
      registered = next;
    },
  } as unknown as ExtensionAPI;
  const extension = normalizeExtension((api) => api.registerTool(tool));
  assert.equal(typeof extension, 'function');
  if (typeof extension === 'function') extension(pi);
  assert.ok(registered);
  assert.equal('type' in property(registered.parameters, 'action'), false);
});

test('a union with a local $ref keeps branches typed and no parent type', () => {
  const schema = {
    type: 'object',
    properties: {
      value: { anyOf: [{ $ref: '#/$defs/Model' }, { type: 'null' }] },
    },
    $defs: {
      Model: { type: 'object', properties: { name: { type: 'string' } } },
    },
  } as unknown as TSchema;
  const normalized = normalizeToolSchema(schema);
  assert.equal('type' in property(normalized, 'value'), false);
  const defs = Reflect.get(normalized, '$defs') as Record<string, Record<string, unknown>>;
  assert.equal(defs.Model?.['type'], 'object');
});

test('a union with an untyped branch stays without a parent type', () => {
  const schema = {
    type: 'object',
    properties: { value: { anyOf: [{ type: 'string' }, {}] } },
  } as unknown as TSchema;
  const normalized = normalizeToolSchema(schema);
  assert.equal('type' in property(normalized, 'value'), false);
});

test('an untyped $ref target leaves its union without a parent type', () => {
  const schema = {
    type: 'object',
    properties: { value: { anyOf: [{ $ref: '#/$defs/Model' }, { type: 'null' }] } },
    $defs: { Model: { properties: { name: { type: 'string' } } } },
  } as unknown as TSchema;
  const normalized = normalizeToolSchema(schema);
  assert.equal('type' in property(normalized, 'value'), false);
});

test('schema maps and literal payloads are not rewritten as schemas', () => {
  const schema = {
    type: 'object',
    properties: {
      const: { type: 'string' },
      name: { type: 'string' },
      payload: { const: { const: 'x' } },
    },
    dependencies: { enum: ['other'] },
  } as unknown as TSchema;
  const normalized = normalizeToolSchema(schema);
  const properties = Reflect.get(normalized, 'properties') as Record<string, unknown>;
  const dependencies = Reflect.get(normalized, 'dependencies') as Record<string, unknown>;
  assert.equal('type' in properties, false);
  assert.equal('type' in dependencies, false);
  assert.deepEqual((properties['payload'] as Record<string, unknown>)['const'], { const: 'x' });
});

test('array constants and enum literals declare the array type', () => {
  const schema = {
    type: 'object',
    properties: {
      tuple: { const: [1, 2] },
      choices: { enum: [['a'], ['b']] },
      empty: { const: [] },
      words: { const: ['string'] },
    },
  } as unknown as TSchema;
  const normalized = normalizeToolSchema(schema);
  assert.equal(property(normalized, 'tuple')['type'], 'array');
  assert.equal(property(normalized, 'choices')['type'], 'array');
  assert.equal(property(normalized, 'empty')['type'], 'array');
  assert.equal(property(normalized, 'words')['type'], 'array');
  assert.deepEqual(property(normalized, 'tuple')['const'], [1, 2]);
  assert.deepEqual(property(normalized, 'choices')['enum'], [['a'], ['b']]);
});

test('extension API wrapping normalizes child tool registrations', () => {
  const tool: ToolDefinition = {
    name: 'child',
    label: 'Child',
    description: 'Test tool',
    parameters: Type.Object({ action: Type.Union([Type.Literal('a'), Type.Literal('b')]) }),
    execute: async () => ({ content: [], details: undefined }),
  };
  let registered: ToolDefinition | undefined;
  const pi = {
    registerTool: (next: ToolDefinition) => {
      registered = next;
    },
  } as unknown as ExtensionAPI;
  normalizeExtensionAPI(pi).registerTool(tool);
  assert.ok(registered);
  assert.equal('type' in property(registered.parameters, 'action'), false);
});
