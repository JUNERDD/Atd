import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';

/** Validates unknown boundary input against a TypeBox schema. */
export function parse<T extends TSchema>(schema: T, value: unknown): Static<T> {
  if (Value.Check(schema, value)) return value;
  const issue = [...Value.Errors(schema, value)][0];
  throw new TypeError(`Invalid data${issue ? `: ${issue.instancePath} ${issue.message}` : '.'}`);
}

/** Best-effort message extraction that never throws and never leaks objects. */
export function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The operation could not be completed.';
}
