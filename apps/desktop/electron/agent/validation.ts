import type { Static, TSchema } from 'typebox';
import { Compile, type Validator } from 'typebox/compile';
import { Value } from 'typebox/value';

/**
 * Compiled validators generate their check with `new Function`. The renderer and web page CSPs
 * forbid that, and typebox's own probe for it logs a CSP violation there, so only a process
 * without a page (Electron main, Node) compiles; pages keep the interpreted `Value` check.
 */
const compiles = typeof document === 'undefined';

/** One compiled validator per schema object, so each schema compiles once per process. */
const validators = new WeakMap<TSchema, Validator>();

function check<T extends TSchema>(schema: T, value: unknown): value is Static<T> {
  if (!compiles) return Value.Check(schema, value);
  let validator = validators.get(schema);
  if (!validator) {
    validator = Compile(schema);
    validators.set(schema, validator);
  }
  return validator.Check(value);
}

export function parse<T extends TSchema>(schema: T, value: unknown): Static<T> {
  if (check(schema, value)) return value;
  const issue = [...Value.Errors(schema, value)][0];
  throw new TypeError(`Invalid data${issue ? `: ${issue.instancePath} ${issue.message}` : '.'}`);
}

export function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The operation could not be completed.';
}
