import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';

/**
 * Checks with typebox's interpreted `Value` API. Its compiled validators generate their check with
 * `new Function`, which the page's CSP forbids.
 */
export function parse<T extends TSchema>(schema: T, value: unknown): Static<T> {
  if (Value.Check(schema, value)) return value;
  const issue = [...Value.Errors(schema, value)][0];
  throw new TypeError(`Invalid data${issue ? `: ${issue.instancePath} ${issue.message}` : '.'}`);
}

export function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The operation could not be completed.';
}
