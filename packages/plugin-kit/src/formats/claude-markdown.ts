import type { CommandComponent } from '../model/manifest.js';
import { parseCommandTemplate } from './command-template.js';
import {
  addComponent,
  isRecord,
  itemName,
  readText,
  report,
  reportShell,
  type AdapterContext,
} from './context.js';
import {
  firstLine,
  hasShellInjection,
  lenientFrontmatter,
  parseMarkdown,
  splitList,
  stringField,
  type MarkdownDocument,
} from './frontmatter.js';
import { baseName } from './paths.js';

/** Fields a manifest `commands` object entry may set over the file's frontmatter. */
export interface CommandOverrides {
  description?: string;
  argumentHint?: string;
  model?: string;
  allowedTools?: string[];
}

const AGENT_FIELDS = new Set(['name', 'description', 'tools', 'model']);

/** Parses frontmatter; on invalid YAML falls back to plain `key: value` lines, as Claude does. */
function readDocument(ctx: AdapterContext, path: string, text: string): MarkdownDocument {
  const document = parseMarkdown(text);
  if (document.error === undefined) return document;
  report(
    ctx,
    'warning',
    'invalid-component',
    `Frontmatter is not valid YAML (${document.error}); only simple "key: value" lines are read.`,
    { path },
  );
  return { ...document, frontmatter: lenientFrontmatter(document.source) };
}

/** Claude `arguments`: a YAML list of names or `{ name, description }`, or a spaced string. */
function readArguments(
  ctx: AdapterContext,
  path: string,
  value: unknown,
): CommandComponent['arguments'] {
  if (value === undefined) return [];
  const raw = typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : value;
  if (!Array.isArray(raw)) {
    report(ctx, 'warning', 'invalid-component', '"arguments" must be a list; ignored.', { path });
    return [];
  }
  const result: CommandComponent['arguments'] = [];
  for (const entry of raw as unknown[]) {
    const name = typeof entry === 'string' ? entry : isRecord(entry) ? entry.name : undefined;
    const description = isRecord(entry) ? entry.description : undefined;
    if (typeof name !== 'string' || name === '' || name.length > 128) {
      report(ctx, 'warning', 'invalid-component', 'An "arguments" entry has no usable name.', {
        path,
      });
      continue;
    }
    result.push(
      typeof description === 'string'
        ? { name, description: description.slice(0, 1000) }
        : { name },
    );
  }
  return result.slice(0, 32);
}

/**
 * Loads a Claude command from `path`, or from inline `content` declared in the manifest (then
 * `path` is the manifest). The body stays unsubstituted; placeholders become segments. An
 * `allowed-tools` value that is not a list skips the command: an empty list inherits the host's
 * tools, so dropping the value would widen it.
 */
export async function loadClaudeCommand(
  ctx: AdapterContext,
  path: string,
  rawName: string,
  options: { content?: string; overrides?: CommandOverrides } = {},
): Promise<void> {
  const text = options.content ?? (await readText(ctx, path));
  if (text === null) return;
  const name = itemName(ctx, 'command', rawName, path);
  if (name === null) return;
  const { frontmatter, body } = readDocument(ctx, path, text);
  const overrides = options.overrides ?? {};
  const tools = overrides.allowedTools ?? splitList(frontmatter['allowed-tools']);
  if (tools === null) {
    report(
      ctx,
      'warning',
      'invalid-component',
      `Command "${name}" is skipped: its allowed-tools are not a list of tool names.`,
      { path, component: { kind: 'command', name } },
    );
    return;
  }
  const args = readArguments(ctx, path, frontmatter.arguments);
  const argumentHint = overrides.argumentHint ?? stringField(frontmatter, 'argument-hint');
  const model = overrides.model ?? stringField(frontmatter, 'model');
  if (hasShellInjection(body)) reportShell(ctx, path, 'command', name);
  const description =
    overrides.description ?? stringField(frontmatter, 'description') ?? firstLine(body) ?? '';
  addComponent(
    ctx,
    {
      kind: 'command',
      name,
      description: description.slice(0, 4000),
      ...(argumentHint === undefined ? {} : { argumentHint: argumentHint.slice(0, 512) }),
      arguments: args,
      segments: parseCommandTemplate(
        body,
        'claude',
        args.map((argument) => argument.name),
      ),
      allowedTools: tools.filter((tool) => tool.length <= 256).slice(0, 256),
      ...(model === undefined ? {} : { model: model.slice(0, 256) }),
      source: path,
    },
    path,
  );
}

/**
 * Loads a Claude subagent. `prefix` holds the nested directories below the scanned agents dir
 * (`review` for `agents/review/security.md`); a frontmatter `name` replaces only the file part.
 * Fields the kit does not map (hooks, mcpServers, permissionMode, memory, isolation, …) are
 * dropped with one info diagnostic. A `tools` value that is not a list skips the agent: an empty
 * list means the host default, so dropping the value would widen the agent.
 */
export async function loadClaudeAgent(
  ctx: AdapterContext,
  path: string,
  prefix: string,
): Promise<void> {
  const text = await readText(ctx, path);
  if (text === null) return;
  const { frontmatter, body } = readDocument(ctx, path, text);
  const fileName = baseName(path).replace(/\.md$/i, '');
  const localName = stringField(frontmatter, 'name') ?? fileName;
  const name = itemName(ctx, 'agent', prefix === '' ? localName : `${prefix}/${localName}`, path);
  if (name === null) return;
  const component = { kind: 'agent', name };
  const description = stringField(frontmatter, 'description');
  if (description === undefined) {
    report(ctx, 'warning', 'invalid-component', `Agent "${name}" has no description.`, {
      path,
      component,
    });
    return;
  }
  if (body.length > 200000) {
    report(ctx, 'warning', 'invalid-component', `Agent "${name}" prompt is too long.`, {
      path,
      component,
    });
    return;
  }
  const tools = splitList(frontmatter.tools);
  if (tools === null) {
    report(
      ctx,
      'warning',
      'invalid-component',
      `Agent "${name}" is skipped: its tools are not a list of tool names.`,
      { path, component },
    );
    return;
  }
  const dropped = Object.keys(frontmatter).filter((key) => !AGENT_FIELDS.has(key));
  if (dropped.length > 0) {
    report(
      ctx,
      'info',
      'unsupported-component',
      `Agent "${name}" fields not supported and dropped: ${dropped.join(', ')}.`,
      { path, component },
    );
  }
  const model = stringField(frontmatter, 'model');
  addComponent(
    ctx,
    {
      kind: 'agent',
      name,
      description: description.slice(0, 4000),
      tools: tools.filter((tool) => tool.length <= 256).slice(0, 256),
      ...(model === undefined ? {} : { model: model.slice(0, 256) }),
      prompt: body,
      source: path,
    },
    path,
  );
}
