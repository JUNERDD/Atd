import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Type, type TSchema } from 'typebox';
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { ComputerToolParametersSchema } from '../dist/computer/calls.js';
import { normalizeExtension, normalizeToolSchema } from '../dist/providers/tool-schema.js';

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
  });
  const normalized = normalizeToolSchema(schema);
  assert.equal(property(normalized, 'action')['type'], 'string');
  assert.equal(property(normalized, 'key')['type'], 'string');
  assert.deepEqual(property(normalized, 'mixed')['type'], ['string', 'null']);
  assert.equal(property(schema, 'action')['type'], undefined);
});

test('the real computer tool schema is clean after normalization', () => {
  const normalized = normalizeToolSchema(ComputerToolParametersSchema);
  assertEveryUnionAndEnumHasType(normalized);
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
