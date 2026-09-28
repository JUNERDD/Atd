import type { NormalizedPlugin } from '../model/manifest.js';
import type { ReadonlyFs } from '../ports.js';
import {
  addComponent,
  createContext,
  itemName,
  listDir,
  pluginName,
  readText,
  report,
  reportShell,
  statPath,
  type AdapterContext,
} from './context.js';
import { invalidManifest } from './errors.js';
import { hasShellInjection, parseMarkdown, stringField } from './frontmatter.js';
import { baseName, displayPath, joinPath } from './paths.js';

export interface SkillLoadOptions {
  /** Name used when the frontmatter has none (the directory name for nested skills). */
  fallbackName: string;
  /** Report Claude `` !`cmd` `` blocks (Claude-style bodies only). */
  checkShell: boolean;
}

/**
 * Loads the Agent Skills folder at `dir` (root-relative, '' for the root). `name` defaults to the
 * folder name and `description` is required; a skill that fails either is skipped with a
 * diagnostic.
 */
export async function loadSkill(
  ctx: AdapterContext,
  dir: string,
  options: SkillLoadOptions,
): Promise<void> {
  const entry = joinPath(dir, 'SKILL.md');
  const text = await readText(ctx, entry);
  if (text === null) return;
  const document = parseMarkdown(text);
  if (document.error !== undefined) {
    report(ctx, 'warning', 'invalid-component', `SKILL.md frontmatter: ${document.error}`, {
      path: entry,
    });
    return;
  }
  const rawName = stringField(document.frontmatter, 'name') ?? options.fallbackName;
  const name = itemName(ctx, 'skill', rawName, entry);
  if (name === null) return;
  const description = stringField(document.frontmatter, 'description');
  if (description === undefined) {
    report(ctx, 'warning', 'invalid-component', `Skill "${name}" has no description.`, {
      path: entry,
      component: { kind: 'skill', name },
    });
    return;
  }
  if (options.checkShell && hasShellInjection(document.body))
    reportShell(ctx, entry, 'skill', name);
  addComponent(
    ctx,
    {
      kind: 'skill',
      name,
      description: description.slice(0, 4000),
      dir: displayPath(dir),
      entry,
      frontmatter: document.frontmatter,
    },
    entry,
  );
}

/**
 * Loads every `<child>/SKILL.md` directly under `dir`. With `allowSelf`, a `dir` that itself holds
 * `SKILL.md` is one skill instead (Claude's `skills` entries accept either shape). `visited`
 * keeps a folder listed twice from loading twice. `rootName` names a skill at the plugin root.
 */
export async function scanSkillDir(
  ctx: AdapterContext,
  dir: string,
  options: { allowSelf: boolean; checkShell: boolean; visited: Set<string>; rootName: string },
): Promise<void> {
  const load = async (skillDir: string, fallbackName: string): Promise<void> => {
    if (options.visited.has(skillDir)) return;
    options.visited.add(skillDir);
    await loadSkill(ctx, skillDir, { fallbackName, checkShell: options.checkShell });
  };
  if ((await statPath(ctx, dir)) !== 'dir') return;
  if (options.allowSelf && (await statPath(ctx, joinPath(dir, 'SKILL.md'))) === 'file') {
    await load(dir, dir === '' ? options.rootName : baseName(dir));
    return;
  }
  for (const entry of await listDir(ctx, dir)) {
    if (entry.kind !== 'dir') continue;
    const child = joinPath(dir, entry.name);
    if ((await statPath(ctx, joinPath(child, 'SKILL.md'))) === 'file')
      await load(child, entry.name);
  }
}

/** A bare Agent Skills folder: the root `SKILL.md` is the plugin's only component. */
export async function normalizeSkillFolder(
  fs: ReadonlyFs,
  fallbackName: string,
): Promise<NormalizedPlugin> {
  const ctx = createContext(fs);
  const text = await readText(ctx, 'SKILL.md');
  if (text === null) throw invalidManifest('SKILL.md cannot be read.', 'SKILL.md');
  const frontmatter = parseMarkdown(text).frontmatter;
  const declared = stringField(frontmatter, 'name');
  const name = pluginName(
    ctx,
    declared ?? fallbackName,
    declared === undefined ? undefined : 'SKILL.md',
  );
  await loadSkill(ctx, '', { fallbackName, checkShell: true });
  const description = stringField(frontmatter, 'description');
  return {
    format: 'skill',
    manifest:
      description === undefined ? { name } : { name, description: description.slice(0, 4000) },
    components: ctx.components,
    userConfig: [],
    diagnostics: ctx.diagnostics,
  };
}
