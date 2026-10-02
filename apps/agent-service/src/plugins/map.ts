import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  SUBAGENT_TOOLS,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
  type McpServerConfig,
  type SubagentTool,
} from '@atd/agent-contracts';
import {
  installedItemName,
  substituteBody,
  substituteTransport,
  type AgentComponent,
  type InstalledPlugin,
  type McpComponent,
  type PluginDiagnostic,
  type SkillComponent,
  type SubstitutionContext,
} from '@atd/plugin-kit';
import { oauthClientProblem } from '../mcp/oauth-client.js';
import type { SkillRevisionRecord } from '../skills/versions.js';
import type { PluginHost } from './host.js';

/**
 * Normalized plugin components as service models (B2). Every model-visible text and every MCP
 * transport is substituted first (plugin-kit `substitute*`, with the installed revision as root),
 * and every name is plugin-kit's `installedItemName`: `<plugin>:<item>`, except the one skill of a
 * standalone `skill`-format plugin, which keeps its bare name. Owners are never parsed from names.
 */

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Source tool names (Claude `Read`, `Bash(git:*)`, pi lowercase) to the service's subagent tools. */
const TOOL_NAMES: Readonly<Record<string, SubagentTool>> = {
  read: 'read',
  grep: 'grep',
  glob: 'find',
  find: 'find',
  ls: 'ls',
  write: 'write',
  edit: 'edit',
  multiedit: 'edit',
  notebookedit: 'edit',
  bash: 'bash',
  command: 'command',
  websearch: WEB_SEARCH_TOOL,
  [WEB_SEARCH_TOOL]: WEB_SEARCH_TOOL,
  webfetch: WEB_FETCH_TOOL,
  [WEB_FETCH_TOOL]: WEB_FETCH_TOOL,
};

/**
 * Maps source tool names to service subagent tools, in catalog order without repeats. Names with
 * no clear counterpart (`Task`, `TodoWrite`, `mcp__*`, …) are dropped: the service ceiling never
 * grants a tool by a name it does not own.
 */
export function mapToolNames(tools: readonly string[]): SubagentTool[] {
  const mapped = new Set<SubagentTool>();
  for (const tool of tools) {
    const key = tool
      .trim()
      .replace(/\(.*\)$/s, '')
      .toLowerCase();
    const known = Object.hasOwn(TOOL_NAMES, key) ? TOOL_NAMES[key] : undefined;
    if (known) mapped.add(known);
  }
  return SUBAGENT_TOOLS.filter((tool) => mapped.has(tool));
}

/** A plugin subagent as the agent catalog and the run freeze see it. */
export interface PluginAgent {
  pluginId: string;
  /** The name references and Settings use (plugin-kit `installedItemName`). */
  name: string;
  localName: string;
  description: string;
  /** Mapped tools; null when the source names none and the run ceiling decides. */
  tools: SubagentTool[] | null;
  systemPrompt: string;
}

/**
 * The source `model` hint is not carried: service subagents never pin a model of their own
 * (subagents/agents.ts), so a hint could only be ignored later.
 */
export function mapAgent(
  plugin: InstalledPlugin,
  component: AgentComponent,
  context: SubstitutionContext,
): PluginAgent {
  return {
    pluginId: plugin.id,
    name: installedItemName(plugin, component.name),
    localName: component.name,
    description: component.description.trim(),
    tools: component.tools.length ? mapToolNames(component.tools) : null,
    systemPrompt: substituteBody(plugin.plugin.format, component.prompt, context).trim(),
  };
}

const SKILL_TOOLS = new Set(['read', 'write', 'edit', 'bash', 'command']);

function skillCapability(frontmatter: Record<string, unknown>): SkillRevisionRecord['capability'] {
  const raw = frontmatter.tools;
  const listed = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const tools = listed
    .filter((tool): tool is string => typeof tool === 'string')
    .map((tool) => tool.trim().toLowerCase())
    .filter((tool) => SKILL_TOOLS.has(tool));
  return { kind: tools.length ? 'script' : 'text', tools };
}

/**
 * A plugin skill as a catalog record under its installed name (`installedItemName`), set
 * explicitly: its folder keeps its local name. The body is substituted; when that changes it, the result is written once under
 * `plugin-host/rendered/<hash>/SKILL.md` and becomes the entry, while `baseDir` stays the skill's
 * folder in the immutable revision, where its references resolve.
 */
export async function mapSkill(
  host: PluginHost,
  plugin: InstalledPlugin,
  component: SkillComponent,
  context: SubstitutionContext,
): Promise<SkillRevisionRecord> {
  const baseDir = path.join(context.root, component.dir);
  const raw = await host.installer.revisionFs(plugin.id, plugin.revision).readText(component.entry);
  const body = substituteBody(plugin.plugin.format, raw, context, baseDir);
  const hash = sha256(body);
  let entry = path.join(context.root, component.entry);
  if (body !== raw) {
    const dir = host.hostDir('rendered', hash);
    await mkdir(dir, { recursive: true });
    entry = path.join(dir, 'SKILL.md');
    // The path is the content's hash: an existing file already holds this body.
    await writeFile(entry, body, { encoding: 'utf8', flag: 'wx' }).catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    });
  }
  return {
    name: installedItemName(plugin, component.name),
    revision: `plg-${hash.slice(0, 32)}`,
    source: `${plugin.id}@${plugin.revision}`,
    sourceKind: 'plugin',
    hash,
    license: plugin.plugin.manifest.license ?? '',
    entry,
    baseDir,
    description: component.description.trim().slice(0, 2048),
    disableModelInvocation: component.frontmatter['disable-model-invocation'] === true,
    capability: skillCapability(component.frontmatter),
    installedAt: plugin.updatedAt,
    pluginId: plugin.id,
  };
}

/** A stable connection id for a plugin server: a plain Identifier, never a qualified name. */
function pluginConnectionId(serverId: string): string {
  return `plg_${sha256(serverId).slice(0, 32)}`;
}

function invalid(component: McpComponent, message: string): PluginDiagnostic {
  return {
    level: 'warning',
    code: 'invalid-component',
    message,
    component: { kind: 'mcp', name: component.name },
  };
}

/** The first bound of the service MCP record the substituted transport breaks, or null. */
function transportProblem(record: McpServerConfig): string | null {
  const values = (map: Record<string, string>) => Object.values(map);
  if (record.stdio) {
    const { command, args, env, cwd } = record.stdio;
    if (!command.trim() || command.length > 1024) return 'its command is empty or too long';
    if (args.length > 100 || args.some((arg) => arg.length > 4096))
      return 'it has too many or too long arguments';
    if (values(env).some((value) => value.length > 8192)) return 'an environment value is too long';
    if (cwd !== null && cwd.length > 2048) return 'its working directory is too long';
  }
  if (record.http) {
    let url: URL;
    try {
      url = new URL(record.http.url);
    } catch {
      return 'its URL is invalid';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'its URL is not http(s)';
    if (record.http.url.length > 2048) return 'its URL is too long';
    if (values(record.http.headers).some((value) => value.length > 8192))
      return 'a header value is too long';
    if (record.http.auth.type === 'oauth') return oauthClientProblem(record.http.auth);
  }
  return null;
}

/**
 * A plugin MCP server as a read-only service record under its qualified id (MCP components
 * never come from standalone skills, so the id is always `<plugin>:<item>`). It is disabled unless
 * resolution made it effective; launching it also needs the user's approval
 * (mcp/launch-approvals.ts). Env and headers
 * carry their substituted values, secrets included; the record lives only in memory, and a Personal
 * duplicate leaves those entries out (plugins/duplicate.ts). An HTTP URL or header keeps its
 * process-environment `${VAR}` for the service to fill in at launch (mcp/launch-resolve.ts), so the
 * launch approval sees which variables it sends (mcp/env-references.ts). An HTTP server signs in
 * with OAuth: with the client its plugin declares, else when it answers 401. `revision` is derived from the substituted config, so any change (update,
 * config value) counts as a new revision and a connection is never reused across it. Diagnostics
 * from substitution name the server.
 */
export function mapMcp(
  plugin: InstalledPlugin,
  component: McpComponent,
  context: SubstitutionContext,
  enabled: boolean,
): { record: McpServerConfig | null; diagnostics: PluginDiagnostic[] } {
  const substituted = substituteTransport(plugin.plugin.format, component.transport, context);
  const diagnostics = substituted.diagnostics.map((diagnostic) => ({
    ...diagnostic,
    component: diagnostic.component ?? { kind: 'mcp', name: component.name },
  }));
  const serverId = installedItemName(plugin, component.name);
  const transport = substituted.transport;
  const record: McpServerConfig = {
    serverId,
    revision: 1 + Number.parseInt(sha256(JSON.stringify(transport)).slice(0, 7), 16),
    connectionId: pluginConnectionId(serverId),
    transport: transport.type === 'stdio' ? 'stdio' : transport.protocol,
    stdio:
      transport.type === 'stdio'
        ? {
            command: transport.command,
            args: transport.args,
            env: transport.env,
            cwd: transport.cwd ?? null,
          }
        : null,
    http:
      transport.type === 'http'
        ? {
            url: transport.url,
            transport: transport.protocol,
            headers: transport.headers,
            // A declared OAuth client signs in with it; any other server is offered OAuth when
            // it answers 401 without a configured Authorization header (mcp/oauth-capable.ts).
            auth: transport.oauth
              ? { type: 'oauth', scope: null, redirectUri: null, ...transport.oauth }
              : { type: 'none' },
          }
        : null,
    principal: '',
    isolateByTask: false,
    // Plugin servers are read-only: their tools reach the model by tool count, their resources
    // never; a Personal duplicate can change either.
    exposeResources: false,
    exposure: 'auto',
    approveTools: true,
    includeTools: [],
    excludeTools: [],
    requestTimeoutMs: null,
    disabled: !enabled,
  };
  const problem = transportProblem(record);
  if (!problem) return { record, diagnostics };
  return {
    record: null,
    diagnostics: [
      ...diagnostics,
      invalid(component, `MCP server "${component.name}" is skipped: ${problem}.`),
    ],
  };
}
