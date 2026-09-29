import type { PluginDiagnostic } from '../model/diagnostics.js';
import type { McpTransport, PluginFormat, UserConfigValue } from '../model/manifest.js';
import {
  claudeTransportResolver,
  expander,
  ownValue,
  pluginDirectoryResolver,
  secretDetector,
  userConfigKey,
} from './expand.js';
import { resolveCommand, resolveCwd } from './paths.js';

/** Values available to substitution for one installed plugin. */
export interface SubstitutionContext {
  /** Absolute path of the published revision directory. */
  root: string;
  /** Absolute path of the plugin's persistent data directory (survives updates). */
  data: string;
  /** Non-sensitive and sensitive values together, keyed by user config key. */
  config: Record<string, UserConfigValue>;
  /** Keys whose values must never appear in model-visible text. */
  sensitive: ReadonlySet<string>;
  /** Process environment for Claude `${VAR}` / `${VAR:-default}` in `.mcp.json`. */
  env: Readonly<Record<string, string | undefined>>;
}

/**
 * Resolves variables in one MCP transport following the format's exact rules (see README):
 * Agent Plugins expands only `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` in `args`, `env` values and
 * `cwd`; Claude also expands `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`,
 * `${user_config.KEY}` and `${VAR[:-default]}` in command, args, env, url and headers. In an
 * HTTP url or header, a `${VAR}` stays `${VAR}` (its `:-` default aside) for the MCP client to
 * fill in from the same process environment when it connects, so the transport shows which
 * variables it sends to the server rather than their values. Single pass, non-recursive. For
 * stdio it also injects `PLUGIN_ROOT`, `PLUGIN_DATA` and the `CLAUDE_PLUGIN_*` aliases into
 * `env` (after the declared env), and resolves a `./` command and relative `cwd` against
 * `root`. Unresolvable variables stay literal and are reported.
 */
export function substituteTransport(
  format: PluginFormat,
  transport: McpTransport,
  context: SubstitutionContext,
): { transport: McpTransport; diagnostics: PluginDiagnostic[] } {
  if (format === 'pi' || format === 'skill') return { transport, diagnostics: [] };
  const diagnostics: PluginDiagnostic[] = [];
  const claude = format === 'claude';
  if (transport.type === 'http') {
    if (!claude) return { transport, diagnostics };
    const expandHttp = expander(claudeTransportResolver(context, diagnostics, true));
    const headers = Object.fromEntries(
      Object.entries(transport.headers).map(([name, value]) => [name, expandHttp(value)]),
    );
    return { transport: { ...transport, url: expandHttp(transport.url), headers }, diagnostics };
  }
  const expand = expander(
    claude ? claudeTransportResolver(context, diagnostics) : pluginDirectoryResolver(context),
  );
  const command = resolveCommand(
    claude ? expand(transport.command) : transport.command,
    context.root,
    diagnostics,
  );
  const args = transport.args.map(expand);
  const declaredEnv = Object.fromEntries(
    Object.entries(transport.env).map(([name, value]) => [
      claude ? expand(name) : name,
      expand(value),
    ]),
  );
  const cwd = resolveCwd(
    transport.cwd === undefined ? undefined : expand(transport.cwd),
    context.root,
    diagnostics,
  );
  // The host's directory variables win over declared values of the same name.
  const env = {
    ...declaredEnv,
    PLUGIN_ROOT: context.root,
    PLUGIN_DATA: context.data,
    CLAUDE_PLUGIN_ROOT: context.root,
    CLAUDE_PLUGIN_DATA: context.data,
  };
  return {
    transport: { type: 'stdio', command, args, env, cwd },
    diagnostics,
  };
}

/** The parts of a substituted MCP transport that took a secret (see `secretDetector`). */
export interface TransportSecrets {
  /** Env names, as substituted, whose values took a secret. */
  env: string[];
  /** Header names whose values took a secret. */
  headers: string[];
  /** Whether the command, an argument, the working directory, the URL or an env name took one. */
  elsewhere: boolean;
}

/**
 * Names where `substituteTransport` puts secrets into a transport, so a copy of the substituted
 * transport outside the plugin (a Personal duplicate) can leave them out instead of storing them
 * in plain text. Only the Claude format substitutes secrets. An HTTP `${VAR}` the environment
 * supplies still counts, although the substituted transport keeps only the reference.
 */
export function transportSecrets(
  format: PluginFormat,
  transport: McpTransport,
  context: SubstitutionContext,
): TransportSecrets {
  if (format !== 'claude') return { env: [], headers: [], elsewhere: false };
  const secret = secretDetector(context);
  const named = (entries: Record<string, string>) =>
    Object.entries(entries).flatMap(([name, value]) => (secret(value) ? [name] : []));
  if (transport.type === 'http')
    return { env: [], headers: named(transport.headers), elsewhere: secret(transport.url) };
  const expand = expander(claudeTransportResolver(context, []));
  return {
    env: named(transport.env).map(expand),
    headers: [],
    elsewhere: [
      transport.command,
      ...transport.args,
      transport.cwd ?? '',
      ...Object.keys(transport.env),
    ].some(secret),
  };
}

/**
 * Resolves variables in a model-visible markdown body (skill, agent, command text). Claude
 * bodies expand `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_SKILL_DIR}` (with
 * `skillDir`) and `${user_config.KEY}`; sensitive keys become `[redacted:KEY]`. Other formats
 * return the body unchanged.
 */
export function substituteBody(
  format: PluginFormat,
  body: string,
  context: SubstitutionContext,
  skillDir?: string,
): string {
  if (format !== 'claude') return body;
  return expander((expression) => {
    if (expression === 'CLAUDE_PLUGIN_ROOT') return context.root;
    if (expression === 'CLAUDE_PLUGIN_DATA') return context.data;
    if (expression === 'CLAUDE_SKILL_DIR') return skillDir;
    const key = userConfigKey(expression);
    if (key === undefined) return undefined;
    if (context.sensitive.has(key)) return `[redacted:${key}]`;
    const value = ownValue(context.config, key);
    return value === undefined ? undefined : String(value);
  })(body);
}
