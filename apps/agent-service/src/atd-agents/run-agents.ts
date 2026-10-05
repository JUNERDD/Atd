import { errorMessage, type SubagentPermissions } from '@atd/agent-contracts';
import type { PluginAgent } from '../plugins/map.js';
import { atdRuntimeAgent, pluginRuntimeAgent, type RuntimeAgent } from '../subagents/agents.js';
import { listAtdAgents } from './catalog.js';

/**
 * The catalog subagents one run registers: every `~/.atd/agents` specialist Settings has not
 * turned off and every plugin subagent effective in the run's frozen plugin snapshot, whether or
 * not its message references them. Each is built as a referenced one always was: runtime name
 * `atd.<name>` or `plugin.<…>`, tools within the run's child ceiling plus the web tools, and its
 * Settings permission override (subagents/agents.ts). They freeze at accept with the run's other
 * selections (run-freeze.ts), so a catalog change applies from the next run through the run
 * binding key (run-binding.ts). Writes into `~/.atd/agents` are confirmed (catalog-writes.ts).
 */

/**
 * pi-subagents keeps at most 200 runtime agents per parent session; this leaves room for the
 * agents a task defines for itself.
 */
const MAX_CATALOG_AGENTS = 128;
/** pi-subagents' bounds on a runtime agent's description and system prompt. */
const MAX_DESCRIPTION = 4096;
const MAX_SYSTEM_PROMPT = 1024 * 1024;

/** What the run's freeze resolved before its catalog subagents. */
export interface CatalogAgentSources {
  /** The run's child tool ceiling: its frozen role capabilities. */
  toolCeiling: readonly string[];
  /** Catalog names turned off in Settings (atd-agents/harness.ts); not plugin subagents. */
  disabled: ReadonlySet<string>;
  /** Settings permission overrides by catalog name (atd-agents/harness.ts). */
  permissions: ReadonlyMap<string, SubagentPermissions>;
  /** Plugin subagents effective in the run's frozen plugin snapshot, by qualified name. */
  plugins: ReadonlyMap<string, PluginAgent>;
}

/** A catalog subagent the run registers, with what a reference to it tells the model. */
export interface CatalogRunAgent {
  /** Its catalog name: the `~/.atd/agents` name, or `<plugin>:<item>` for a plugin's. */
  name: string;
  description: string;
  /** Where it comes from, as a reference hint names it. */
  source: string;
  agent: RuntimeAgent;
  /** What a reference audit adds, such as the model a run never applies. */
  audit: Record<string, unknown>;
}

/** A run's catalog subagents. */
export interface RunCatalogAgents {
  /** In registration order: `~/.atd/agents` by file name, then plugin subagents. */
  registered: CatalogRunAgent[];
  /** Why a catalog name the run knows is not registered. */
  unavailable: ReadonlyMap<string, string>;
  /** Why `~/.atd/agents` could not be read; null when it was. */
  catalogError: string | null;
}

/**
 * Freezes a run's catalog subagents. A file that does not load stays out with its diagnostic, and
 * an unreadable catalog leaves only the plugin subagents; neither fails the run.
 */
export async function freezeCatalogAgents(sources: CatalogAgentSources): Promise<RunCatalogAgents> {
  const registered: CatalogRunAgent[] = [];
  const unavailable = new Map<string, string>();
  const skip = (name: string, reason: string) => {
    if (!unavailable.has(name)) unavailable.set(name, reason);
  };
  const add = (
    entry: Omit<CatalogRunAgent, 'agent'>,
    built: { agent: RuntimeAgent } | { reason: string },
  ) => {
    // Two files can load as one name; the first, by file name, is the one a reference finds.
    if (registered.some((item) => item.name === entry.name)) return;
    if ('reason' in built) return skip(entry.name, built.reason);
    const refused = registrationRefusal(built.agent);
    if (refused) return skip(entry.name, refused);
    if (registered.length >= MAX_CATALOG_AGENTS)
      return skip(entry.name, `a run registers at most ${MAX_CATALOG_AGENTS} catalog subagents`);
    registered.push({ ...entry, agent: built.agent });
  };
  // A plugin subagent's switch is its plugin item, which the snapshot already applied.
  for (const name of sources.disabled)
    if (!sources.plugins.has(name)) skip(name, 'it is turned off in Settings');
  let catalogError: string | null = null;
  try {
    const catalog = await listAtdAgents();
    for (const entry of catalog.agents) {
      if (sources.disabled.has(entry.name)) continue;
      const { name, description, model } = entry;
      add(
        { name, description, source: '~/.atd/agents', audit: { ignoredModel: model } },
        atdRuntimeAgent(entry, sources.toolCeiling, sources.permissions.get(name)),
      );
    }
    for (const diagnostic of catalog.diagnostics) skip(diagnostic.agent, diagnostic.message);
  } catch (error) {
    catalogError = `the agent catalog could not be read (${errorMessage(error)})`;
  }
  for (const agent of sources.plugins.values()) {
    const { name, description, pluginId } = agent;
    add(
      { name, description, source: `plugin ${pluginId}`, audit: {} },
      pluginRuntimeAgent(agent, sources.toolCeiling, sources.permissions.get(name)),
    );
  }
  return { registered, unavailable, catalogError };
}

/** The registered catalog subagent named `name`, else why the run has none under that name. */
export function catalogRunAgent(agents: RunCatalogAgents, name: string): CatalogRunAgent | string {
  return (
    agents.registered.find((entry) => entry.name === name) ??
    agents.unavailable.get(name) ??
    agents.catalogError ??
    'it is not in ~/.atd/agents or an enabled plugin'
  );
}

/**
 * Why pi-subagents would refuse to register `agent`, checked as its registry checks a definition's
 * text (`validateString` in src/agents/runtime-agent-registry.js, pi-subagents 0.74.0; building
 * the agent already refused NUL characters). One refused registration takes the session's whole
 * agent set with it (subagents/agents.ts `registerRuntimeAgents`), so the agent stays out instead.
 */
function registrationRefusal({ definition }: RuntimeAgent): string | null {
  const fields = [
    ['description', definition.description, MAX_DESCRIPTION],
    ['system prompt', definition.systemPrompt, MAX_SYSTEM_PROMPT],
  ] as const;
  for (const [field, value, max] of fields) {
    if (!value || value.trim() !== value)
      return `its ${field} is empty or begins or ends with white space`;
    if (value.length > max) return `its ${field} is longer than ${max} characters`;
  }
  return null;
}
