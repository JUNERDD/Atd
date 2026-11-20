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

function property(schema: TSchema, name: string): Record<string, unknown> {
  const properties = Reflect.get(schema, 'properties');
  assert.ok(properties && typeof properties === 'object');
  const value = Reflect.get(properties, name);
  assert.ok(value && typeof value === 'object');
  return value as Record<string, unknown>;
}

function assertEveryUnionAndEnumHasType(value: unknown, path = ''): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertEveryUnionAndEnumHasType(child, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const schema = value as Record<string, unknown>;
  if (
    ('anyOf' in schema || 'oneOf' in schema || 'enum' in schema || 'const' in schema) &&
    !('type' in schema)
  )
    assert.fail(`missing type at ${path || '<root>'}`);
  for (const [key, child] of Object.entries(schema))
    assertEveryUnionAndEnumHasType(child, path ? `${path}.${key}` : key);
}

test('tool schemas declare types on enums and unions', () => {
  const schema = Type.Object({
    action: Type.Union([Type.Literal('observe'), Type.Literal('act')]),
    key: Type.Enum(['a', 'b']),
    mixed: Type.Union([Type.Literal('text'), Type.Null()]),
    count: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  });
  const normalized = normalizeToolSchema(schema);
  assert.equal(property(normalized, 'action')['type'], 'string');
  assert.equal(property(normalized, 'key')['type'], 'string');
  assert.deepEqual(property(normalized, 'mixed')['type'], ['string', 'null']);
  assert.deepEqual(property(normalized, 'count')['type'], ['integer', 'null']);
  assert.equal(property(schema, 'action')['type'], undefined);
});

test('the real command tool schema types its integer revision union', () => {
  const normalized = normalizeToolSchema(CommandToolParametersSchema);
  assert.deepEqual(property(normalized, 'expectedRevision')['type'], ['integer', 'null']);
});

test('the real computer tool schema is clean after normalization', () => {
  const normalized = normalizeToolSchema(ComputerToolParametersSchema);
  assertEveryUnionAndEnumHasType(normalized);
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
  assert.equal(property(normalizeToolSchema(schema), 'value')['type'], 'string');
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
  assert.equal(property(registered.parameters, 'action')['type'], 'string');
});

test('a union with a local $ref resolves every branch', () => {
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
  assert.deepEqual(property(normalized, 'value')['type'], ['object', 'null']);
});

test('a union with an untyped branch stays untyped', () => {
  const schema = {
    type: 'object',
    properties: { value: { anyOf: [{ type: 'string' }, {}] } },
  } as unknown as TSchema;
  const normalized = normalizeToolSchema(schema);
  assert.equal('type' in property(normalized, 'value'), false);
});

test('an untyped $ref target leaves its union untyped', () => {
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
  assert.equal(property(registered.parameters, 'action')['type'], 'string');
});
