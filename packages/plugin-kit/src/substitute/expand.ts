import type { PluginDiagnostic } from '../model/diagnostics.js';
import type { SubstitutionContext } from './index.js';

/**
 * `${...}` without nested braces. `String.replace` never rescans inserted text, which is what
 * makes every expansion a single, non-recursive pass.
 */
const PLACEHOLDER = /\$\{([^{}]*)\}/g;
const USER_CONFIG = /^user_config\.([A-Za-z_][A-Za-z0-9_]*)$/;
const ENV_REFERENCE = /^([A-Za-z_][A-Za-z0-9_]*)(?::-([\s\S]*))?$/;

/** Returns the replacement for a placeholder expression, or undefined to keep it literal. */
export type PlaceholderResolver = (expression: string) => string | undefined;
export type Expander = (text: string) => string;

export function expander(resolve: PlaceholderResolver): Expander {
  return (text) =>
    text.replace(PLACEHOLDER, (match, expression: string) => resolve(expression) ?? match);
}

/** Own-property lookup, so keys such as `constructor` never reach `Object.prototype`. */
export function ownValue<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function userConfigKey(expression: string): string | undefined {
  return USER_CONFIG.exec(expression)?.[1];
}

/** Agent Plugins MCP rule: only the two plugin directories are variables. */
export function pluginDirectoryResolver(context: SubstitutionContext): PlaceholderResolver {
  return (expression) => {
    if (expression === 'PLUGIN_ROOT') return context.root;
    if (expression === 'PLUGIN_DATA') return context.data;
    return undefined;
  };
}

/**
 * Claude `.mcp.json` rule: plugin directories, user config (sensitive values included, since the
 * service keeps transports from the model and redacts env and header values from its clients;
 * `transportSecrets` names the entries that took one) and process environment with POSIX `:-` defaults, which
 * apply when the variable is unset or empty. Each unresolved reference is reported once.
 *
 * With `deferEnv`, a process-environment reference whose default does not apply is written back
 * as `${NAME}` instead of its value, for the MCP client to fill in when it connects. The host then
 * sees which variables an HTTP transport sends, and no environment value enters the transport.
 */
export function claudeTransportResolver(
  context: SubstitutionContext,
  diagnostics: PluginDiagnostic[],
  deferEnv = false,
): PlaceholderResolver {
  const reported = new Set<string>();
  const report = (diagnostic: PluginDiagnostic) => {
    if (reported.has(diagnostic.message)) return;
    reported.add(diagnostic.message);
    diagnostics.push(diagnostic);
  };
  return (expression) => {
    if (expression === 'CLAUDE_PLUGIN_ROOT') return context.root;
    if (expression === 'CLAUDE_PLUGIN_DATA') return context.data;
    const key = userConfigKey(expression);
    if (key !== undefined) {
      const value = ownValue(context.config, key);
      if (value !== undefined) return String(value);
      report({
        level: 'warning',
        code: 'needs-config',
        message: `MCP setting "\${user_config.${key}}" has no value and was left unexpanded.`,
      });
      return undefined;
    }
    const reference = ENV_REFERENCE.exec(expression);
    if (!reference) return undefined;
    const [, name = '', fallback] = reference;
    const value = ownValue(context.env, name);
    const env = deferEnv ? `\${${name}}` : value;
    if (value !== undefined && value !== '') return env;
    if (fallback !== undefined) return fallback;
    if (value !== undefined) return env;
    report({
      level: 'warning',
      code: 'invalid-component',
      message: `Environment variable "${name}" is not set and has no default; "\${${name}}" was left unexpanded.`,
    });
    return undefined;
  };
}

/**
 * Whether Claude transport text takes a secret when substituted: a sensitive
 * `${user_config.KEY}`, or a `${VAR}` whose value the process environment supplies (the service's
 * own environment may hold credentials). Plugin directories and `:-` defaults are not secrets.
 */
export function secretDetector(context: SubstitutionContext): (text: string) => boolean {
  return (text) =>
    [...text.matchAll(PLACEHOLDER)].some(([, expression = '']) => {
      if (expression === 'CLAUDE_PLUGIN_ROOT' || expression === 'CLAUDE_PLUGIN_DATA') return false;
      const key = userConfigKey(expression);
      if (key !== undefined) return context.sensitive.has(key);
      const name = ENV_REFERENCE.exec(expression)?.[1];
      if (name === undefined) return false;
      const value = ownValue(context.env, name);
      return value !== undefined && value !== '';
    });
}
