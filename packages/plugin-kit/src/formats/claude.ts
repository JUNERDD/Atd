import type { NormalizedPlugin } from '../model/manifest.js';
import type { ReadonlyFs } from '../ports.js';
import { readUserConfig } from './claude-config.js';
import { loadClaudeAgent, loadClaudeCommand, type CommandOverrides } from './claude-markdown.js';
import { loadClaudeMcp } from './claude-mcp.js';
import {
  createContext,
  isRecord,
  parseJson,
  pluginName,
  readText,
  report,
  reportEscape,
  statPath,
  stringArray,
  type AdapterContext,
} from './context.js';
import { invalidManifest } from './errors.js';
import { markdownFiles } from './glob.js';
import { readMetadata } from './metadata.js';
import { baseName, dirName, readManifestPath } from './paths.js';
import { loadSkill, scanSkillDir } from './skill.js';

/** Claude Code plugins: https://code.claude.com/docs/en/plugins-reference */
const MANIFEST = '.claude-plugin/plugin.json';
const METADATA_FIELDS = [
  'displayName',
  'version',
  'description',
  'license',
  'homepage',
  'repository',
  'author',
  'keywords',
];
const HANDLED_FIELDS = new Set([
  ...METADATA_FIELDS,
  '$schema',
  'name',
  'metadata',
  'userConfig',
  'skills',
  'commands',
  'agents',
  'mcpServers',
]);
/** Defined by Claude but not imported by the kit (they run code or configure Claude itself). */
const UNSUPPORTED_FIELDS = new Set([
  'hooks',
  'lspServers',
  'outputStyles',
  'workflows',
  'channels',
  'settings',
  'experimental',
  'dependencies',
  'themes',
  'monitors',
]);
const UNSUPPORTED_PATHS = [
  'hooks',
  'bin',
  '.lsp.json',
  'output-styles',
  'workflows',
  'themes',
  'monitors',
  'settings.json',
];

async function readManifest(ctx: AdapterContext): Promise<Record<string, unknown> | null> {
  if ((await statPath(ctx, MANIFEST)) !== 'file') return null;
  const text = await readText(ctx, MANIFEST);
  if (text === null) throw invalidManifest(`${MANIFEST} cannot be read.`, MANIFEST);
  const manifest = parseJson(ctx, MANIFEST, text);
  if (!isRecord(manifest)) throw invalidManifest(`${MANIFEST} must be a JSON object.`, MANIFEST);
  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    throw invalidManifest(`${MANIFEST} must set "name".`, MANIFEST);
  }
  return manifest;
}

function reportFields(ctx: AdapterContext, manifest: Record<string, unknown>): void {
  for (const key of Object.keys(manifest)) {
    if (HANDLED_FIELDS.has(key)) continue;
    if (key === 'defaultEnabled') continue;
    const supported = UNSUPPORTED_FIELDS.has(key);
    report(
      ctx,
      'warning',
      supported ? 'unsupported-component' : 'unknown-field',
      supported
        ? `Manifest "${key}" is not supported; ignored.`
        : `Manifest field "${key}" is not defined by Claude plugins; ignored.`,
      { path: MANIFEST },
    );
  }
}

/** Resolves a manifest path, reporting escapes and missing `./` prefixes. */
function manifestPath(ctx: AdapterContext, raw: unknown, allowRoot = false): string | null {
  if (typeof raw !== 'string') {
    report(ctx, 'warning', 'invalid-component', 'Manifest component paths must be strings.', {
      path: MANIFEST,
    });
    return null;
  }
  const resolved = readManifestPath(raw, allowRoot);
  if (resolved.ok) return resolved.path;
  if (resolved.reason === 'escape') reportEscape(ctx, raw);
  else {
    report(ctx, 'warning', 'invalid-component', `Manifest path "${raw}" must start with "./".`, {
      path: MANIFEST,
    });
  }
  return null;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function reportMissing(ctx: AdapterContext, path: string, expected: string): void {
  report(ctx, 'warning', 'invalid-component', `"${path}" is not ${expected}.`, { path });
}

/** Default `skills/` scan (or a root `SKILL.md` without it) plus manifest `skills` directories. */
async function loadSkills(ctx: AdapterContext, declared: unknown, rootName: string): Promise<void> {
  const visited = new Set<string>();
  const scan = { checkShell: true, visited, rootName };
  if ((await statPath(ctx, 'skills')) === 'dir') {
    await scanSkillDir(ctx, 'skills', { ...scan, allowSelf: false });
  } else if ((await statPath(ctx, 'SKILL.md')) === 'file') {
    visited.add('');
    await loadSkill(ctx, '', { fallbackName: rootName, checkShell: true });
  }
  if (declared === undefined) return;
  for (const raw of asList(declared)) {
    const path = manifestPath(ctx, raw, true);
    if (path === null) continue;
    if ((await statPath(ctx, path)) !== 'dir') reportMissing(ctx, path, 'a directory');
    else await scanSkillDir(ctx, path, { ...scan, allowSelf: true });
  }
}

/** Every `.md` below `dir`; nested directories flatten into the name (`db/migrate`). */
async function scanCommands(ctx: AdapterContext, dir: string): Promise<void> {
  for (const path of await markdownFiles(ctx, dir)) {
    const relative = dir === '' ? path : path.slice(dir.length + 1);
    await loadClaudeCommand(ctx, path, relative.replace(/\.md$/i, ''));
  }
}

async function loadCommandPath(ctx: AdapterContext, raw: unknown): Promise<void> {
  const path = manifestPath(ctx, raw);
  if (path === null) return;
  const kind = await statPath(ctx, path);
  if (kind === 'dir') await scanCommands(ctx, path);
  else if (kind === 'file' && path.toLowerCase().endsWith('.md')) {
    await loadClaudeCommand(ctx, path, baseName(path).replace(/\.md$/i, ''));
  } else reportMissing(ctx, path, 'a markdown file or directory');
}

/**
 * A manifest command entry's overrides, or null when its `allowedTools` is not a list of strings:
 * the command is then skipped, as one with unreadable `allowed-tools` frontmatter is.
 */
function readOverrides(
  ctx: AdapterContext,
  name: string,
  entry: Record<string, unknown>,
): CommandOverrides | null {
  const overrides: CommandOverrides = {};
  if (typeof entry.description === 'string') overrides.description = entry.description;
  if (typeof entry.argumentHint === 'string') overrides.argumentHint = entry.argumentHint;
  if (typeof entry.model === 'string') overrides.model = entry.model;
  if (entry.allowedTools === undefined || entry.allowedTools === null) return overrides;
  const tools = stringArray(entry.allowedTools);
  if (tools === null) {
    report(
      ctx,
      'warning',
      'invalid-component',
      `Command "${name}" is skipped: its allowedTools are not a list of tool names.`,
      { path: MANIFEST, component: { kind: 'command', name: name.slice(0, 256) } },
    );
    return null;
  }
  overrides.allowedTools = tools;
  return overrides;
}

/** Manifest `commands` replaces the default `commands/` scan. */
async function loadCommands(ctx: AdapterContext, declared: unknown): Promise<void> {
  if (declared === undefined) {
    await scanCommands(ctx, 'commands');
    return;
  }
  if (!isRecord(declared)) {
    for (const raw of asList(declared)) await loadCommandPath(ctx, raw);
    return;
  }
  for (const [name, entry] of Object.entries(declared)) {
    const source = isRecord(entry) ? entry.source : undefined;
    const content = isRecord(entry) ? entry.content : undefined;
    if (!isRecord(entry) || (typeof source === 'string') === (typeof content === 'string')) {
      report(
        ctx,
        'warning',
        'invalid-component',
        `Command "${name}" must set exactly one of "source" or "content".`,
        { path: MANIFEST, component: { kind: 'command', name: name.slice(0, 256) } },
      );
      continue;
    }
    const overrides = readOverrides(ctx, name, entry);
    if (overrides === null) continue;
    if (typeof content === 'string') {
      await loadClaudeCommand(ctx, MANIFEST, name, { content, overrides });
      continue;
    }
    const path = manifestPath(ctx, source);
    if (path !== null) await loadClaudeCommand(ctx, path, name, { overrides });
  }
}

/** Manifest `agents` (`.md` files only) replaces the default recursive `agents/` scan. */
async function loadAgents(ctx: AdapterContext, declared: unknown): Promise<void> {
  if (declared === undefined) {
    for (const path of await markdownFiles(ctx, 'agents')) {
      await loadClaudeAgent(ctx, path, dirName(path.slice('agents/'.length)));
    }
    return;
  }
  for (const raw of asList(declared)) {
    const path = manifestPath(ctx, raw);
    if (path === null) continue;
    const isFile = (await statPath(ctx, path)) === 'file';
    if (isFile && path.toLowerCase().endsWith('.md')) await loadClaudeAgent(ctx, path, '');
    else reportMissing(ctx, path, 'an agent markdown file');
  }
}

export async function normalizeClaudePlugin(
  fs: ReadonlyFs,
  fallbackName: string,
): Promise<NormalizedPlugin> {
  const ctx = createContext(fs);
  const manifest = await readManifest(ctx);
  const raw = manifest ?? {};
  const name = pluginName(
    ctx,
    typeof raw.name === 'string' ? raw.name : fallbackName,
    manifest ? MANIFEST : undefined,
  );
  reportFields(ctx, raw);
  const known = Object.fromEntries(
    METADATA_FIELDS.filter((field) => field in raw).map((field) => [field, raw[field]]),
  );
  const { metadata, problems } = readMetadata(known, {
    repositoryObject: true,
    authorString: true,
  });
  for (const problem of problems) {
    report(ctx, 'warning', 'unknown-field', `${problem} Ignored.`, { path: MANIFEST });
  }
  const userConfig = readUserConfig(ctx, raw.userConfig);
  await loadSkills(ctx, raw.skills, name);
  await loadCommands(ctx, raw.commands);
  await loadAgents(ctx, raw.agents);
  await loadClaudeMcp(ctx, raw.mcpServers);
  for (const path of UNSUPPORTED_PATHS) {
    if ((await statPath(ctx, path)) === null) continue;
    report(ctx, 'warning', 'unsupported-component', `"${path}" is not supported; ignored.`, {
      path,
    });
  }
  return {
    format: 'claude',
    manifest: { name, ...metadata },
    components: ctx.components,
    userConfig,
    diagnostics: ctx.diagnostics,
  };
}
