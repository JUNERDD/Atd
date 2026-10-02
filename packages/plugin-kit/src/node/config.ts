import type { UserConfigOption, UserConfigValue } from '../model/manifest.js';
import type { ConfigValues, PluginStateFile } from '../model/records.js';
import type { SecretStore } from '../ports.js';

/** A config value does not match its declared option. */
export class PluginConfigError extends Error {
  constructor(
    readonly pluginId: string,
    readonly key: string,
    message: string,
  ) {
    super(message);
    this.name = 'PluginConfigError';
  }
}

function checkValue(pluginId: string, option: UserConfigOption, value: UserConfigValue): void {
  const fail = (message: string) => {
    throw new PluginConfigError(pluginId, option.key, `"${option.key}" ${message}`);
  };
  switch (option.type) {
    case 'boolean':
      if (typeof value !== 'boolean') fail('must be true or false.');
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('must be a number.');
      else if (option.min !== undefined && value < option.min)
        fail(`must be at least ${option.min}.`);
      else if (option.max !== undefined && value > option.max)
        fail(`must be at most ${option.max}.`);
      return;
    case 'string':
    case 'directory':
    case 'file':
      if (typeof value !== 'string') fail('must be text.');
      else if (option.options !== undefined && !option.options.includes(value)) {
        fail(`must be one of: ${option.options.join(', ')}.`);
      }
  }
}

/** Sensitive values are stored as text; this restores the declared type. */
function fromSecret(option: UserConfigOption, text: string): UserConfigValue {
  if (option.type === 'number') return Number(text);
  if (option.type === 'boolean') return text === 'true';
  return text;
}

/**
 * Validates every value before anything is written, then writes sensitive values to `secrets`
 * and the rest into `state.config` (mutated in place; the caller persists it).
 */
export async function applyConfig(
  pluginId: string,
  options: UserConfigOption[],
  values: Record<string, UserConfigValue | null>,
  state: PluginStateFile,
  secrets: SecretStore,
): Promise<void> {
  const byKey = new Map(options.map((option) => [option.key, option]));
  const changes: [UserConfigOption, UserConfigValue | null][] = [];
  for (const [key, value] of Object.entries(values)) {
    const option = byKey.get(key);
    if (option === undefined) {
      throw new PluginConfigError(pluginId, key, `"${key}" is not a setting of ${pluginId}.`);
    }
    if (value !== null) checkValue(pluginId, option, value);
    changes.push([option, value]);
  }
  const stored = { ...state.config[pluginId] };
  for (const [option, value] of changes) {
    if (option.sensitive) {
      if (value === null) await secrets.delete(pluginId, option.key);
      else await secrets.set(pluginId, option.key, String(value));
      delete stored[option.key];
    } else if (value === null) delete stored[option.key];
    else stored[option.key] = value;
  }
  if (Object.keys(stored).length === 0) delete state.config[pluginId];
  else state.config[pluginId] = stored;
}

/** Explicit values, falling back to each option's default; unset keys without one are absent. */
export async function collectConfig(
  pluginId: string,
  options: UserConfigOption[],
  state: PluginStateFile,
  secrets: SecretStore,
): Promise<ConfigValues> {
  const stored = state.config[pluginId] ?? {};
  const values: ConfigValues = {};
  for (const option of options) {
    let value: UserConfigValue | undefined;
    if (option.sensitive) {
      const secret = await secrets.get(pluginId, option.key);
      value = secret === null ? undefined : fromSecret(option, secret);
    } else {
      value = stored[option.key];
    }
    value ??= option.default;
    if (value !== undefined) values[option.key] = value;
  }
  return values;
}
