import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TSchema } from 'typebox';
import { validateToolArguments } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { normalizeToolSchema } from '../dist/providers/tool-schema.js';

function property(schema: TSchema, name: string): Record<string, unknown> {
  const properties = Reflect.get(schema, 'properties');
  assert.ok(properties && typeof properties === 'object');
  const value = Reflect.get(properties, name);
  assert.ok(value && typeof value === 'object');
  return value as Record<string, unknown>;
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

function fieldSchema(field: Record<string, unknown>, required: readonly string[] = ['v']): TSchema {
  return {
    type: 'object',
    properties: { v: field },
    ...(required.length > 0 ? { required: [...required] } : {}),
  } as unknown as TSchema;
}

test('conjunctive type beside anyOf is preserved and enforced in validation', () => {
  const normalized = normalizeToolSchema({
    type: 'object',
    properties: {
      a: { type: 'string', anyOf: [{ minLength: 3 }, { pattern: '^X' }] },
      b: { type: 'string' },
      nested: {
        type: 'object',
        properties: { x: { type: 'string' }, y: { type: 'string' } },
        anyOf: [{ required: ['x'] }, { required: ['y'] }],
      },
    },
    anyOf: [{ required: ['a'] }, { required: ['b'] }],
  } as unknown as TSchema);
  assert.equal(Reflect.get(normalized, 'type'), 'object');
  assert.equal(property(normalized, 'a')['type'], 'string');
  assert.equal(property(normalized, 'nested')['type'], 'object');
  const tool = makeTool('conj', normalized);
  assert.deepEqual(callArgs(tool, { a: 'X' }), { a: 'X' });
  const badInputs = [
    42,
    'hello',
    [],
    true,
    { a: {} },
    { a: ['abc'] },
    { a: 42 },
    { b: 'ok', nested: 42 },
  ];
  for (const bad of badInputs) assert.throws(() => callArgs(tool, bad));
});

test('pure non-root unions strip redundant parent type while root keeps type', () => {
  const normalized = normalizeToolSchema({
    type: 'object',
    properties: {
      mode: { type: 'string', description: 'Mode', anyOf: [{ const: 'a' }, { const: 'b' }] },
      nullable: { type: ['string', 'null'], anyOf: [{ type: 'string' }, { type: 'null' }] },
      widenedNumber: {
        type: 'number',
        anyOf: [
          { type: 'integer', minimum: 0 },
          { type: 'integer', maximum: -10 },
        ],
      },
      multiSubsumed: {
        type: ['number', 'string'],
        anyOf: [{ type: ['integer', 'string'] }, { type: 'number' }],
      },
    },
  } as unknown as TSchema);

  for (const name of ['mode', 'nullable', 'widenedNumber', 'multiSubsumed']) {
    assert.equal('type' in property(normalized, name), false, `${name} must strip redundant type`);
  }
  assert.deepEqual(
    (property(normalized, 'mode')['anyOf'] as Array<Record<string, unknown>>).map((b) => b['type']),
    ['string', 'string'],
  );

  const tool = makeTool('redundant', normalized);
  assert.deepEqual(callArgs(tool, { mode: 'a', nullable: null, widenedNumber: -12 }), {
    mode: 'a',
    nullable: null,
    widenedNumber: -12,
  });
  assert.throws(() => callArgs(tool, { nullable: { bad: 1 } }));
  // pi-schema@1.6+ truncates 1.5 -> 1 into the `minimum: 0` integer branch, matching the
  // unnormalized schema; values outside both integer ranges or non-integers that stay invalid fail.
  assert.deepEqual(callArgs(tool, { widenedNumber: 1.5 }), { widenedNumber: 1 });
  assert.throws(() => callArgs(tool, { widenedNumber: -5 }));
  assert.throws(() => callArgs(tool, { widenedNumber: -1.5 }));

  const rootUnion = normalizeToolSchema({
    type: 'object',
    anyOf: [
      { type: 'object', required: ['a'] },
      { type: 'object', required: ['b'] },
    ],
  } as unknown as TSchema);
  assert.equal(Reflect.get(rootUnion, 'type'), 'object');
});

test('narrowing parent type over wider or heterogeneous union branches is preserved', () => {
  // 1. string narrows string | object
  const stringOverObject = normalizeToolSchema(
    fieldSchema({ type: 'string', anyOf: [{ type: 'string' }, { type: 'object' }] }),
  );
  assert.equal(property(stringOverObject, 'v')['type'], 'string');
  const tool1 = makeTool('narrow-1', stringOverObject);
  assert.deepEqual(callArgs(tool1, { v: 'ok' }), { v: 'ok' });
  assert.throws(() => callArgs(tool1, { v: { nested: 1 } }));

  // 2. integer narrows number branches (integer is subtype of number, not vice versa)
  const integerOverNumber = normalizeToolSchema(
    fieldSchema({
      type: 'integer',
      anyOf: [
        { type: 'number', minimum: 0 },
        { type: 'number', maximum: -10 },
      ],
    }),
  );
  assert.equal(property(integerOverNumber, 'v')['type'], 'integer');
  const tool2 = makeTool('narrow-2', integerOverNumber);
  assert.deepEqual(callArgs(tool2, { v: 2 }), { v: 2 });
  assert.throws(() => callArgs(tool2, { v: 1.5 }));

  // 3. string narrows oneOf const branches typed bottom-up as string | number
  const stringOverConst = normalizeToolSchema(
    fieldSchema({ type: 'string', oneOf: [{ const: 'a' }, { const: 1 }] }),
  );
  assert.equal(property(stringOverConst, 'v')['type'], 'string');
  assert.deepEqual(
    (property(stringOverConst, 'v')['oneOf'] as Array<Record<string, unknown>>).map(
      (b) => b['type'],
    ),
    ['string', 'number'],
  );
  const tool3 = makeTool('narrow-3', stringOverConst);
  assert.deepEqual(callArgs(tool3, { v: 'a' }), { v: 'a' });
  assert.throws(() => callArgs(tool3, { v: 1 }));

  // 4. optional string narrows nullable enum branch so normalizeOptionalNulls strips null
  const optionalNonNull = normalizeToolSchema(
    fieldSchema({ type: 'string', anyOf: [{ enum: ['a', null] }, { const: 'b' }] }, []),
  );
  assert.equal(property(optionalNonNull, 'v')['type'], 'string');
  const tool4 = makeTool('narrow-4', optionalNonNull);
  assert.deepEqual(callArgs(tool4, { v: null }), {});
  assert.deepEqual(callArgs(tool4, { v: 'a' }), { v: 'a' });

  const requiredNonNull = normalizeToolSchema(
    fieldSchema({ type: 'string', anyOf: [{ enum: ['a', null] }, { const: 'b' }] }),
  );
  assert.throws(() => callArgs(makeTool('narrow-4-req', requiredNonNull), { v: null }));

  // 5. string narrows string | number and preserves numeric-to-string coercion
  const stringCoercion = normalizeToolSchema(
    fieldSchema({ type: 'string', anyOf: [{ type: 'string' }, { type: 'number' }] }),
  );
  assert.equal(property(stringCoercion, 'v')['type'], 'string');
  assert.deepEqual(callArgs(makeTool('narrow-5', stringCoercion), { v: 42 }), { v: '42' });
});

test('invalid, empty, or partially narrowed union type declarations keep parent type', () => {
  const normalized = normalizeToolSchema({
    type: 'object',
    properties: {
      invalidParent: { type: 'bogus', anyOf: [{ type: 'string' }] },
      emptyParent: { type: [], anyOf: [{ type: 'string' }] },
      invalidBranch: { type: 'string', anyOf: [{ type: 'string' }, { type: 'bogus' }] },
      emptyBranchType: { type: 'string', anyOf: [{ type: 'string' }, { type: [] }] },
      dualKeywords: {
        type: 'string',
        anyOf: [{ type: 'string' }],
        oneOf: [{ type: 'string' }, { type: 'number' }],
      },
      multiNarrowed: {
        type: ['integer', 'string'],
        anyOf: [{ type: ['number', 'string'] }, { type: 'integer' }],
      },
    },
  } as unknown as TSchema);

  assert.equal(property(normalized, 'invalidParent')['type'], 'bogus');
  assert.deepEqual(property(normalized, 'emptyParent')['type'], []);
  assert.equal(property(normalized, 'invalidBranch')['type'], 'string');
  assert.equal(property(normalized, 'emptyBranchType')['type'], 'string');
  assert.equal(property(normalized, 'dualKeywords')['type'], 'string');
  assert.deepEqual(property(normalized, 'multiNarrowed')['type'], ['integer', 'string']);
});

test('$ref and untyped-branch unions preserve branch types without parent type', () => {
  const withRef = normalizeToolSchema({
    type: 'object',
    properties: { value: { anyOf: [{ $ref: '#/$defs/Model' }, { type: 'null' }] } },
    $defs: { Model: { type: 'object', properties: { name: { type: 'string' } } } },
  } as unknown as TSchema);
  assert.equal('type' in property(withRef, 'value'), false);
  const defs = Reflect.get(withRef, '$defs') as Record<string, Record<string, unknown>>;
  assert.equal(defs.Model?.['type'], 'object');

  const untypedBranch = normalizeToolSchema({
    type: 'object',
    properties: { value: { anyOf: [{ type: 'string' }, {}] } },
  } as unknown as TSchema);
  assert.equal('type' in property(untypedBranch, 'value'), false);

  const untypedRef = normalizeToolSchema({
    type: 'object',
    properties: { value: { anyOf: [{ $ref: '#/$defs/Model' }, { type: 'null' }] } },
    $defs: { Model: { properties: { name: { type: 'string' } } } },
  } as unknown as TSchema);
  assert.equal('type' in property(untypedRef, 'value'), false);
});
