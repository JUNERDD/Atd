import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The names of the configured agents pi-subagents discovers for a parent's cwd: its builtin,
 * package, user (`~/.agents`, the agent dir's `agents`) and project agent files, by name, local
 * name and alias. Once a runtime agent shares one of them, pi-subagents refuses the session's
 * agent set at every discovery (`assertNoConfiguredCollision` in its runtime agent registry), and
 * every list and launch of that parent fails; no runtime agent may therefore take one.
 *
 * pi-subagents exports no discovery entry point, so this loads the module its list action and
 * launches discover with by file path, as trigger.ts loads its child-session module, with the
 * global npm root its extension also resolves. It fails when those modules moved or their
 * output changed shape, so callers fail closed instead of missing a collision.
 */

interface DiscoveryModule {
  discoverAgentsAll(
    cwd: string,
    preferredModelProvider: string | undefined,
    options: { includeChains: boolean; globalNpmRoot: string | null },
  ): unknown;
}

interface GlobalRootModule {
  resolveGlobalNpmRoot(): Promise<string | null>;
}

interface Discovery {
  module: DiscoveryModule;
  /** Resolved once per process: it runs `npm root -g`. */
  globalRoot: Promise<string | null>;
}

/** Why a runtime agent cannot take `agent` beside the configured agents, or null when it can. */
export type NameCollision = (agent: string) => string | null;

/** The discovery groups pi-subagents checks runtime agents against. */
const CONFIGURED_GROUPS = ['builtin', 'package', 'user', 'project'] as const;

let discovery: Promise<Discovery> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDiscoveryModule(value: unknown): value is DiscoveryModule {
  return isRecord(value) && typeof value['discoverAgentsAll'] === 'function';
}

function isGlobalRootModule(value: unknown): value is GlobalRootModule {
  return isRecord(value) && typeof value['resolveGlobalNpmRoot'] === 'function';
}

function packageRoot(): string {
  const require = createRequire(import.meta.url);
  // The exports map hides ./package.json, so the main entry's directory is the package root.
  try {
    return path.dirname(require.resolve('pi-subagents'));
  } catch {
    return path.join(process.cwd(), 'node_modules', 'pi-subagents');
  }
}

async function load(): Promise<Discovery> {
  const agents = path.join(packageRoot(), 'src', 'agents');
  const [agentsModule, globalRootModule]: unknown[] = await Promise.all([
    import(pathToFileURL(path.join(agents, 'agents.js')).href),
    import(pathToFileURL(path.join(agents, 'global-npm-root.js')).href),
  ]);
  if (!isDiscoveryModule(agentsModule))
    throw new Error('pi-subagents agent discovery is unavailable.');
  if (!isGlobalRootModule(globalRootModule))
    throw new Error('pi-subagents global package discovery is unavailable.');
  // A failure only leaves global packages out, as in pi-subagents' own discovery.
  const globalRoot = globalRootModule.resolveGlobalNpmRoot().catch(() => null);
  return { module: agentsModule, globalRoot };
}

function loaded(): Promise<Discovery> {
  discovery ??= load().catch((error: unknown) => {
    // A later call retries; an upstream change that moved the modules fails every one.
    discovery = null;
    throw error;
  });
  return discovery;
}

/** Starts loading discovery, and resolving the global npm root, before a session needs them. */
export function preloadConfiguredAgents(): void {
  loaded().catch(() => undefined);
}

/** One discovered agent's names: its name, local name and aliases. */
function agentNames(agent: unknown): string[] {
  if (!isRecord(agent) || typeof agent['name'] !== 'string')
    throw new Error('pi-subagents agent discovery returned an agent without a name.');
  const aliases = agent['aliases'] ?? [];
  if (!Array.isArray(aliases))
    throw new Error('pi-subagents agent discovery returned bad aliases.');
  return [agent['name'], agent['localName'], ...aliases].filter(
    (name): name is string => typeof name === 'string',
  );
}

/** Every name, local name and alias of the configured agents `cwd` discovers. */
export async function configuredAgentNames(cwd: string): Promise<ReadonlySet<string>> {
  const { module, globalRoot } = await loaded();
  const discovered = module.discoverAgentsAll(cwd, undefined, {
    includeChains: false,
    globalNpmRoot: await globalRoot,
  });
  if (!isRecord(discovered)) throw new Error('pi-subagents agent discovery returned no agents.');
  const names = new Set<string>();
  for (const group of CONFIGURED_GROUPS) {
    const agents = discovered[group];
    if (!Array.isArray(agents))
      throw new Error(`pi-subagents agent discovery returned no ${group} agents.`);
    for (const agent of agents) for (const name of agentNames(agent)) names.add(name);
  }
  return names;
}

/**
 * The collision check for runtime agents a parent at `cwd` registers. When the configured agents
 * cannot be read, `error` says why and every name collides with that reason. Never throws.
 */
export async function nameCollisions(
  cwd: string,
): Promise<{ collision: NameCollision; error: string | null }> {
  try {
    const names = await configuredAgentNames(cwd);
    const collision: NameCollision = (agent) =>
      names.has(agent) ? 'an agent configured outside this app has this name' : null;
    return { collision, error: null };
  } catch (error) {
    const reason = `the configured agents could not be checked (${error instanceof Error ? error.message : String(error)})`;
    return { collision: () => reason, error: reason };
  }
}
