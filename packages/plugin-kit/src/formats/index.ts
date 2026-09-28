import type { NormalizedPlugin, PluginFormat } from '../model/manifest.js';
import type { FsEntry, ReadonlyFs } from '../ports.js';
import { normalizeAgentPlugin } from './agent-plugins.js';
import { normalizeClaudePlugin } from './claude.js';
import { isRecord, stripBom } from './context.js';
import { invalidManifest } from './errors.js';
import { normalizePiPackage } from './pi.js';
import { normalizeSkillFolder } from './skill.js';

export { InvalidPluginError } from './errors.js';

/** Options every adapter accepts. */
export interface NormalizeOptions {
  /**
   * Name to use when the bundle has no manifest name (Claude without `plugin.json`, a bare skill
   * folder): the directory or package name. Normalized with `toPluginName`.
   */
  fallbackName: string;
}

/** Detection only asks questions; any filesystem failure (including an escape) means "absent". */
async function kindOf(fs: ReadonlyFs, path: string): Promise<FsEntry['kind'] | null> {
  try {
    return await fs.stat(path);
  } catch {
    return null;
  }
}

async function readJsonQuietly(
  fs: ReadonlyFs,
  path: string,
): Promise<Record<string, unknown> | null> {
  if ((await kindOf(fs, path)) !== 'file') return null;
  try {
    const value: unknown = JSON.parse(stripBom(await fs.readText(path)));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** Default Claude component locations that identify a manifest-less Claude plugin. */
const CLAUDE_MARKERS = ['commands', 'agents', 'hooks', '.mcp.json', '.claude-plugin'];

/**
 * Detects the bundle layout at the root of `fs`, in precedence order: Agent Plugins `plugin.json`
 * (with its `$schema`), `.claude-plugin/plugin.json` or Claude default component dirs,
 * `package.json` with a `pi` key or `pi-package` keyword, then a root `SKILL.md`. Returns null
 * when nothing is recognized.
 *
 * A `skills/` folder with no other marker is a manifest-less Claude plugin: Agent Plugins requires
 * `plugin.json`, while Claude loads the standard layout without one.
 */
export async function detectFormat(fs: ReadonlyFs): Promise<PluginFormat | null> {
  const plugin = await readJsonQuietly(fs, 'plugin.json');
  const schema = plugin?.$schema;
  if (typeof schema === 'string' && schema.includes('agent-plugins.org')) return 'agent-plugins';
  if ((await kindOf(fs, '.claude-plugin/plugin.json')) === 'file') return 'claude';
  const hasRootManifest = (await kindOf(fs, 'plugin.json')) !== null;
  if (!hasRootManifest) {
    for (const marker of CLAUDE_MARKERS) {
      if ((await kindOf(fs, marker)) !== null) return 'claude';
    }
  }
  const pkg = await readJsonQuietly(fs, 'package.json');
  if (pkg && (pkg.pi !== undefined || isPiKeyword(pkg.keywords))) return 'pi';
  if (!hasRootManifest && (await kindOf(fs, 'skills')) === 'dir') return 'claude';
  if ((await kindOf(fs, 'SKILL.md')) === 'file') return 'skill';
  return null;
}

function isPiKeyword(keywords: unknown): boolean {
  return Array.isArray(keywords) && keywords.includes('pi-package');
}

/**
 * Detects and normalizes one bundle. Never throws for component-level problems (they become
 * diagnostics); throws `InvalidPluginError` only when the bundle is unusable as a whole.
 */
export async function normalizePlugin(
  fs: ReadonlyFs,
  options: NormalizeOptions,
): Promise<NormalizedPlugin> {
  const format = await detectFormat(fs);
  switch (format) {
    case 'agent-plugins':
      return normalizeAgentPlugin(fs);
    case 'claude':
      return normalizeClaudePlugin(fs, options.fallbackName);
    case 'pi':
      return normalizePiPackage(fs, options.fallbackName);
    case 'skill':
      return normalizeSkillFolder(fs, options.fallbackName);
    case null:
      throw invalidManifest(
        'No supported plugin layout found (Agent Plugins plugin.json, .claude-plugin, pi package.json or SKILL.md).',
      );
  }
}
