import { Type, type TSchema } from 'typebox';
import {
  COMPUTER_KEY_NAMES,
  COMPUTER_MAX_STEPS,
  ComputerElementLocatorSchema,
  ComputerModelStepSchema,
  ComputerModifierSchema,
  ComputerPointLocatorSchema,
  isPlainKeyInput,
} from '@atd/agent-contracts';

/** Model declarations expose only locators this model can use; host policy still checks each act. */
export function computerModelSteps(capturePoints: boolean) {
  const schema = structuredClone(ComputerModelStepSchema);
  if (capturePoints) return schema;
  for (const { properties } of schema.anyOf) {
    if ('locator' in properties) hideCapturePoints(properties.locator);
    if ('from' in properties) hideCapturePoints(properties.from);
    if ('to' in properties) hideCapturePoints(properties.to);
  }
  return schema;
}

/** Narrow a declaration copy, never the shared contract or read-only capture regions. */
function hideCapturePoints(
  locator: typeof ComputerPointLocatorSchema | typeof ComputerElementLocatorSchema,
) {
  const index = locator.anyOf.findIndex((variant) => 'capture' in variant.properties);
  if (index !== -1) locator.anyOf.splice(index, 1);
}

/**
 * These are additional constraints, not complete step schemas: the root's steps property still
 * validates every field. Keep the effect split aligned with stepEffect; key sets use its helper.
 */
function conditionFreeVariants(step: (typeof ComputerModelStepSchema.anyOf)[number]): TSchema[] {
  const kind = step.properties.kind.const;
  switch (kind) {
    case 'navigate':
    case 'fill':
    case 'scroll':
    case 'wait':
    case 'setValue':
    case 'clear':
    case 'select':
      return [Type.Object({ kind: Type.Literal(kind) })];
    case 'press':
      return [Type.Object({ kind: Type.Literal(kind), effect: Type.Literal('click') })];
    case 'type':
      return [
        Type.Object({ kind: Type.Literal(kind), text: Type.String({ pattern: '^[^\\r\\n]*$' }) }),
      ];
    case 'key':
      return [
        Type.Object({
          kind: Type.Literal(kind),
          key: Type.Enum(COMPUTER_KEY_NAMES.filter((key) => isPlainKeyInput(key))),
          modifiers: Type.Optional(Type.Array(ComputerModifierSchema, { maxItems: 0 })),
        }),
        Type.Object({
          kind: Type.Literal(kind),
          key: Type.Enum(COMPUTER_KEY_NAMES.filter((key) => isPlainKeyInput(key, ['shift']))),
          modifiers: Type.Array(Type.Literal('shift'), { minItems: 1, maxItems: 1 }),
        }),
      ];
    case 'click':
    case 'menu':
    case 'drag':
    case 'upload':
      return [];
  }
}

const ConditionFreeSteps = Type.Array(
  Type.Union(ComputerModelStepSchema.anyOf.flatMap(conditionFreeVariants)),
  { minItems: 1, maxItems: COMPUTER_MAX_STEPS },
);

/** An object-root schema can require a condition without requiring one for read/edit/navigation. */
export function computerActRequirements(nonAct: TSchema) {
  const required = ['action', 'targetRefId', 'observationRefId', 'steps'];
  return [
    Type.Object({ action: nonAct }),
    {
      type: 'object',
      properties: { action: Type.Literal('act') },
      required: [...required, 'postcondition'],
      description: 'Every act containing invoke/submit steps requires postcondition.',
    },
    {
      type: 'object',
      properties: { action: Type.Literal('act'), steps: ConditionFreeSteps },
      required,
      description:
        'Only acts containing exclusively read, plain input, navigation or press(effect:click) may omit postcondition.',
    },
  ];
}
