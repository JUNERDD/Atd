import { randomUUID } from 'node:crypto';
import { cp, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  McpServerConfig,
  PluginDuplicateResponse,
  PluginItemKind,
} from '@atd/agent-contracts';
import { toItemName, transportSecrets } from '@atd/plugin-kit';
import { listAtdAgents, putAtdAgent } from '../atd-agents/catalog.js';
import { atdAgentsDir, atdSkillsDir } from '../service-fs.js';
import { discoverAtdSkills } from '../skills/atd-skills.js';
import { discoverUserAgentSkills } from '../skills/user-agents.js';
import type { SkillRevisionRecord } from '../skills/versions.js';
import { mapPluginComponents } from './components.js';
import { findPlugin } from './detail.js';
import { CORE_PLUGIN, SHARED_PLUGIN, USER_PLUGIN } from './host-plugins.js';
import { findItem, type PluginActions } from './toggle.js';

/** Limits of a `~/.atd/agents` file (atd-agents/catalog.ts `putAtdAgent`). */
const MAX_AGENT_DESCRIPTION = 2048;
const MAX_AGENT_PROMPT = 16000;
const AGENT_FILE_TOOLS = new Set(['read', 'write', 'edit', 'bash', 'command']);

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}

/** `base`, else `base-copy`, `base-copy-2`, … : the first bare name `taken` does not hold. */
async function freeName(base: string, taken: (name: string) => Promise<boolean>): Promise<string> {
  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const suffix = attempt === 1 ? '' : attempt === 2 ? '-copy' : `-copy-${attempt - 1}`;
    const name = toItemName(`${base.slice(0, 128 - suffix.length)}${suffix}`);
    if (name && !(await taken(name))) return name;
  }
  throw new TypeError(`Invalid request: no free name is left for "${base}".`);
}

/** Replaces (or adds) the frontmatter `name:` so the copy loads under its own name. */
function renamed(content: string, name: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match?.[1]) return `---\nname: ${name}\n---\n\n${content}`;
  const lines = match[1].split(/\r?\n/).filter((line) => !/^name\s*:/.test(line));
  return `---\nname: ${name}\n${lines.join('\n')}\n---${content.slice(match[0].length)}`;
}

async function sourceSkill(actions: PluginActions, pluginId: string, name: string) {
  if (pluginId === SHARED_PLUGIN)
    return (await discoverUserAgentSkills()).skills.find((skill) => skill.name === name);
  if (pluginId === CORE_PLUGIN)
    return (await discoverAtdSkills()).skills.find((skill) => skill.name === name);
  const { skills } = await mapPluginComponents(actions.host, actions.view, new Set(['skill']));
  return skills.find(({ item }) => item.pluginId === pluginId && item.localName === name)?.value;
}

/**
 * Copies a skill folder into `~/.atd/skills/<name>`, with the SKILL.md the run would read (a
 * plugin skill's substituted body), renamed in its frontmatter when the name had to change.
 */
async function duplicateSkill(record: SkillRevisionRecord, base: string): Promise<string> {
  const atd = new Set((await discoverAtdSkills()).skills.map((skill) => skill.name));
  const name = await freeName(
    base,
    async (candidate) => atd.has(candidate) || (await exists(path.join(atdSkillsDir(), candidate))),
  );
  const target = path.join(atdSkillsDir(), name);
  await cp(record.baseDir, target, {
    recursive: true,
    dereference: true,
    errorOnExist: true,
    force: false,
  });
  await writeFile(
    path.join(target, 'SKILL.md'),
    renamed(await readFile(record.entry, 'utf8'), name),
  );
  return name;
}

/** An installed plugin's subagent; host plugins other than Personal contribute none. */
async function sourceAgent(actions: PluginActions, pluginId: string, name: string) {
  const { agents } = await mapPluginComponents(actions.host, actions.view, new Set(['agent']));
  return agents.find(({ item }) => item.pluginId === pluginId && item.localName === name)?.value;
}

/** Writes a `~/.atd/agents/<name>.md` copy, within that file's limits and tool names. */
async function duplicateAgent(
  agent: { description: string; systemPrompt: string; tools: readonly string[] | null },
  base: string,
): Promise<string> {
  if (agent.systemPrompt.length > MAX_AGENT_PROMPT)
    throw new TypeError(
      `Invalid request: its prompt is longer than the ${MAX_AGENT_PROMPT} characters a Personal subagent may have.`,
    );
  const existing = new Set((await listAtdAgents()).agents.map((entry) => entry.name));
  // A file that does not load still holds its name: writing `<name>.md` would replace it.
  const name = await freeName(
    base,
    async (candidate) =>
      existing.has(candidate) || (await exists(path.join(atdAgentsDir(), `${candidate}.md`))),
  );
  await putAtdAgent({
    name,
    description: agent.description.slice(0, MAX_AGENT_DESCRIPTION) || name,
    tools: (agent.tools ?? []).filter((tool) => AGENT_FILE_TOOLS.has(tool)),
    model: null,
    systemPrompt: agent.systemPrompt,
  });
  return name;
}

/**
 * A plugin server's record without the env and header entries its plugin filled from a secret,
 * so the copy never stores in plain text what the plugin keeps in the keychain or the service's
 * environment. Refused when a secret sits where no entry can be left out.
 */
async function withoutSecrets(
  actions: PluginActions,
  pluginId: string,
  name: string,
  record: McpServerConfig,
): Promise<{ record: McpServerConfig; omitted: string[] }> {
  const plugin = actions.view.installed.find((entry) => entry.id === pluginId);
  const component = plugin?.plugin.components.find(
    (entry) => entry.kind === 'mcp' && entry.name === name,
  );
  if (!plugin || component?.kind !== 'mcp')
    throw new TypeError(`Invalid request: MCP server "${name}" could not be prepared.`);
  const secrets = transportSecrets(
    plugin.plugin.format,
    component.transport,
    await actions.host.substitution(plugin),
  );
  if (secrets.elsewhere)
    throw new TypeError(
      `Invalid request: MCP server "${name}" passes a secret in its command, arguments or URL, so it cannot be copied to Personal.`,
    );
  const keep = (values: Record<string, string>, omit: readonly string[]) =>
    Object.fromEntries(Object.entries(values).filter(([key]) => !omit.includes(key)));
  return {
    record: {
      ...record,
      stdio: record.stdio && { ...record.stdio, env: keep(record.stdio.env, secrets.env) },
      http: record.http && { ...record.http, headers: keep(record.http.headers, secrets.headers) },
    },
    omitted: [...secrets.env, ...secrets.headers],
  };
}

/**
 * Copies a plugin server into `servers.json` under a bare id, without its secrets (see
 * `withoutSecrets`). The copy starts disabled: turning it on is the user's decision, and a copy
 * that runs a local command also needs the user's launch approval, which the plugin server's own
 * approval never carries over to (mcp/launch-approvals.ts).
 */
async function duplicateServer(
  actions: PluginActions,
  pluginId: string,
  name: string,
): Promise<{ name: string; omitted: string[] }> {
  const authority = await actions.mcp();
  const all = await mapPluginComponents(actions.host, actions.view, new Set(['mcp']));
  const found = all.mcp.find(
    ({ item }) => item.pluginId === pluginId && item.localName === name,
  )?.value;
  if (!found) throw new TypeError(`Invalid request: MCP server "${name}" could not be prepared.`);
  const { record, omitted } = await withoutSecrets(actions, pluginId, name, found);
  const taken = new Set(authority.configured().map((server) => server.serverId));
  const serverId = await freeName(name, async (candidate) => taken.has(candidate));
  await authority.put({
    ...record,
    serverId,
    connectionId: randomUUID(),
    revision: 1,
    disabled: true,
  });
  return { name: serverId, omitted };
}

/** Duplicates one plugin item into the Personal plugin (D8) and answers its Personal name. */
export async function duplicateItem(
  actions: PluginActions,
  pluginId: string,
  kind: PluginItemKind,
  name: string,
): Promise<PluginDuplicateResponse> {
  findPlugin(actions.view, pluginId);
  findItem(actions.view, pluginId, kind, name);
  if (pluginId === USER_PLUGIN)
    throw new TypeError('Invalid request: this item is already in Personal.');
  if (kind === 'command' || kind === 'memory')
    throw new TypeError(`Invalid request: ${kind} items cannot be duplicated.`);
  const base = toItemName(name) ?? 'copy';
  if (kind === 'skill') {
    const record = await sourceSkill(actions, pluginId, name);
    if (!record) throw new TypeError(`Invalid request: skill "${name}" could not be read.`);
    return { kind, name: await duplicateSkill(record, base), omitted: [] };
  }
  if (kind === 'agent') {
    const agent = await sourceAgent(actions, pluginId, name);
    if (!agent) throw new TypeError(`Invalid request: subagent "${name}" could not be read.`);
    return { kind, name: await duplicateAgent(agent, base), omitted: [] };
  }
  return { kind, ...(await duplicateServer(actions, pluginId, name)) };
}
