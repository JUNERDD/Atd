import type { UserConfigOption } from '../model/manifest.js';
import { isRecord, report, stringArray, type AdapterContext } from './context.js';

const MANIFEST = '.claude-plugin/plugin.json';
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TYPES = new Set<UserConfigOption['type']>([
  'string',
  'number',
  'boolean',
  'directory',
  'file',
]);
const FIELDS = new Set([
  'type',
  'title',
  'description',
  'required',
  'default',
  'options',
  'multiple',
  'sensitive',
  'min',
  'max',
]);

function isOptionType(value: unknown): value is UserConfigOption['type'] {
  return typeof value === 'string' && TYPES.has(value as UserConfigOption['type']);
}

/**
 * Reads Claude `userConfig` (a strict object per key). An option with an unknown field, a bad key
 * or a wrongly typed field is skipped; `multiple` lists are not supported, so such an option loads
 * as a single value with a warning.
 */
export function readUserConfig(ctx: AdapterContext, value: unknown): UserConfigOption[] {
  if (value === undefined) return [];
  if (!isRecord(value)) {
    report(ctx, 'warning', 'invalid-component', '"userConfig" must be an object; ignored.', {
      path: MANIFEST,
    });
    return [];
  }
  const options: UserConfigOption[] = [];
  for (const [key, raw] of Object.entries(value)) {
    const problem = KEY.test(key) && key.length <= 128 ? readOption(key, raw) : 'invalid key';
    if (typeof problem === 'string') {
      report(ctx, 'warning', 'invalid-component', `userConfig "${key}": ${problem}; skipped.`, {
        path: MANIFEST,
      });
      continue;
    }
    if (isRecord(raw) && raw.multiple === true) {
      report(
        ctx,
        'warning',
        'unsupported-component',
        `userConfig "${key}": "multiple" is not supported; it accepts one value.`,
        { path: MANIFEST },
      );
    }
    options.push(problem);
  }
  return options;
}

function optionalString(
  raw: Record<string, unknown>,
  field: string,
  limit: number,
): string | null | undefined {
  const value = raw[field];
  if (value === undefined) return undefined;
  return typeof value === 'string' && value.length <= limit ? value : null;
}

/** The option, or a description of its first problem. */
function readOption(key: string, raw: unknown): UserConfigOption | string {
  if (!isRecord(raw)) return 'must be an object';
  const unknown = Object.keys(raw).find((field) => !FIELDS.has(field));
  if (unknown !== undefined) return `unknown field "${unknown}"`;
  if (!isOptionType(raw.type)) return '"type" must be string, number, boolean, directory or file';
  const option: UserConfigOption = {
    key,
    type: raw.type,
    required: raw.required === true,
    sensitive: raw.sensitive === true,
  };
  for (const flag of ['required', 'sensitive', 'multiple'] as const) {
    if (raw[flag] !== undefined && typeof raw[flag] !== 'boolean')
      return `"${flag}" must be a boolean`;
  }
  const title = optionalString(raw, 'title', 256);
  const description = optionalString(raw, 'description', 2000);
  if (title === null || description === null) return '"title" and "description" must be strings';
  if (title !== undefined) option.title = title;
  if (description !== undefined) option.description = description;
  const fallback = raw.default;
  if (fallback !== undefined) {
    if (!['string', 'number', 'boolean'].includes(typeof fallback)) {
      return '"default" must be a string, number or boolean';
    }
    option.default = fallback as string | number | boolean;
  }
  if (raw.options !== undefined) {
    const choices = stringArray(raw.options);
    if (choices === null || choices.length > 100 || choices.some((choice) => choice.length > 256)) {
      return '"options" must be a list of strings';
    }
    option.options = choices;
  }
  for (const bound of ['min', 'max'] as const) {
    const number = raw[bound];
    if (number === undefined) continue;
    if (typeof number !== 'number' || !Number.isFinite(number))
      return `"${bound}" must be a number`;
    option[bound] = number;
  }
  return option;
}
