import type { NormalizedPlugin } from '../model/manifest.js';
import type { ReadonlyFs } from '../ports.js';
import { parseCommandTemplate } from './command-template.js';
import {
  addComponent,
  createContext,
  isRecord,
  itemName,
  parseJson,
  pluginName,
  readText,
  report,
  statPath,
  stringArray,
  type AdapterContext,
} from './context.js';
import { invalidManifest } from './errors.js';
import { firstLine, parseMarkdown, stringField } from './frontmatter.js';
import { readMetadata } from './metadata.js';
import { baseName, dirName } from './paths.js';
import {
  collectResourceFiles,
  manifestResourceFiles,
  type PiResourceType,
} from './pi-resources.js';
import { loadSkill } from './skill.js';

/** pi packages: pi-coding-agent docs/packages.md and docs/prompt-templates.md. */
const MANIFEST = 'package.json';
const METADATA_FIELDS = [
  'version',
  'description',
  'license',
  'homepage',
  'repository',
  'author',
  'keywords',
];
const RESOURCE_TYPES: PiResourceType[] = ['extensions', 'skills', 'prompts', 'themes'];

/**
 * With a `pi` object, only its arrays select resources (a missing array selects none, as in pi);
 * without it, the conventional `extensions/`, `skills/`, `prompts/` and `themes/` directories.
 */
async function resourceFiles(
  ctx: AdapterContext,
  pi: Record<string, unknown> | null,
  type: PiResourceType,
): Promise<string[]> {
  if (pi === null) {
    return (await statPath(ctx, type)) === 'dir' ? collectResourceFiles(ctx, type, type) : [];
  }
  if (pi[type] === undefined) return [];
  const entries = stringArray(pi[type]);
  if (entries === null) {
    report(ctx, 'warning', 'invalid-component', `"pi.${type}" must be an array of strings.`, {
      path: MANIFEST,
    });
    return [];
  }
  return manifestResourceFiles(ctx, entries, type);
}

/** A prompt template becomes a command named after its file. */
async function loadPrompt(ctx: AdapterContext, path: string): Promise<void> {
  const text = await readText(ctx, path);
  if (text === null) return;
  const document = parseMarkdown(text);
  if (document.error !== undefined) {
    report(ctx, 'warning', 'invalid-component', `Prompt frontmatter: ${document.error}`, { path });
    return;
  }
  const name = itemName(ctx, 'command', baseName(path).replace(/\.md$/, ''), path);
  if (name === null) return;
  const line = firstLine(document.body);
  // pi's fallback description is the first non-empty line, cut at 60 characters.
  const fallback = line === undefined ? '' : line.length > 60 ? `${line.slice(0, 60)}...` : line;
  const description = stringField(document.frontmatter, 'description') ?? fallback;
  const argumentHint = stringField(document.frontmatter, 'argument-hint');
  addComponent(
    ctx,
    {
      kind: 'command',
      name,
      description: description.slice(0, 4000),
      ...(argumentHint === undefined ? {} : { argumentHint: argumentHint.slice(0, 512) }),
      arguments: [],
      segments: parseCommandTemplate(document.body, 'pi', []),
      allowedTools: [],
      source: path,
    },
    path,
  );
}

async function loadSkills(ctx: AdapterContext, files: string[], rootName: string): Promise<void> {
  for (const path of files) {
    if (baseName(path) !== 'SKILL.md') {
      report(
        ctx,
        'info',
        'unsupported-component',
        `Standalone markdown skill "${path}" is not supported; use a folder with SKILL.md.`,
        { path },
      );
      continue;
    }
    const dir = dirName(path);
    await loadSkill(ctx, dir, {
      fallbackName: dir === '' ? rootName : baseName(dir),
      checkShell: false,
    });
  }
}

export async function normalizePiPackage(
  fs: ReadonlyFs,
  fallbackName: string,
): Promise<NormalizedPlugin> {
  const ctx = createContext(fs);
  const text = await readText(ctx, MANIFEST);
  if (text === null) throw invalidManifest(`${MANIFEST} cannot be read.`, MANIFEST);
  const pkg = parseJson(ctx, MANIFEST, text);
  if (pkg === undefined) throw invalidManifest(`${MANIFEST} is not valid JSON.`, MANIFEST);
  if (!isRecord(pkg)) throw invalidManifest(`${MANIFEST} must be a JSON object.`, MANIFEST);
  const declared = typeof pkg.name === 'string' && pkg.name !== '' ? pkg.name : undefined;
  const name = pluginName(
    ctx,
    declared ?? fallbackName,
    declared === undefined ? undefined : MANIFEST,
  );
  const known = Object.fromEntries(
    METADATA_FIELDS.filter((field) => field in pkg).map((field) => [field, pkg[field]]),
  );
  const { metadata, problems } = readMetadata(known, {
    repositoryObject: true,
    authorString: true,
  });
  for (const problem of problems) {
    report(ctx, 'warning', 'unknown-field', `${problem} Ignored.`, { path: MANIFEST });
  }
  const pi = isRecord(pkg.pi) ? pkg.pi : null;
  for (const type of RESOURCE_TYPES) {
    const files = await resourceFiles(ctx, pi, type);
    if (type === 'skills') await loadSkills(ctx, files, name);
    else if (type === 'prompts') for (const path of files) await loadPrompt(ctx, path);
    else if (files.length > 0) {
      report(
        ctx,
        'warning',
        'unsupported-component',
        `pi ${type} (${files.length} file${files.length === 1 ? '' : 's'}) are not supported; ignored.`,
        { path: pi === null ? type : MANIFEST },
      );
    }
  }
  return {
    format: 'pi',
    manifest: { name, ...metadata },
    components: ctx.components,
    userConfig: [],
    diagnostics: ctx.diagnostics,
  };
}
