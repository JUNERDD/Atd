import type { NormalizedPlugin } from '../model/manifest.js';
import type { InstallPreview } from '../model/records.js';
import { PathEscapeError, type ReadonlyFs } from '../ports.js';

const SCRIPT_EXTENSIONS = new Set([
  '.sh',
  '.bash',
  '.zsh',
  '.py',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.rb',
  '.pl',
  '.ps1',
  '.bat',
  '.cmd',
]);
/** Bounds the walk through symlinked directories, which may form cycles. */
const MAX_DEPTH = 16;

/** Joins root-relative POSIX paths; component dirs use '.' for the plugin root. */
function joinPath(dir: string, relative: string): string {
  const base = dir === '.' ? '' : dir;
  return base === '' ? relative : relative === '' ? base : `${base}/${relative}`;
}

function isScript(relativeToSkill: string): boolean {
  const segments = relativeToSkill.split('/');
  if (segments.slice(0, -1).includes('scripts')) return true;
  const name = segments.at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 && SCRIPT_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

async function collectScripts(
  fs: ReadonlyFs,
  dir: string,
  prefix: string,
  depth: number,
  out: Set<string>,
): Promise<void> {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await fs.list(joinPath(dir, prefix));
  } catch (error) {
    if (error instanceof PathEscapeError) return;
    throw error;
  }
  for (const entry of entries) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.kind === 'dir') await collectScripts(fs, dir, relative, depth + 1, out);
    else if (isScript(relative)) out.add(joinPath(dir, relative));
  }
}

/**
 * What the user should look at before confirming: stdio commands the host may later run, remote
 * MCP endpoints, and executable-looking files shipped inside skill folders.
 */
export async function buildReview(
  plugin: NormalizedPlugin,
  fs: ReadonlyFs,
): Promise<InstallPreview['review']> {
  const review: InstallPreview['review'] = { stdio: [], urls: [], scripts: [] };
  const scripts = new Set<string>();
  for (const component of plugin.components) {
    if (component.kind === 'mcp') {
      const { transport } = component;
      if (transport.type === 'stdio') {
        review.stdio.push({
          name: component.name,
          command: transport.command,
          args: transport.args,
        });
      } else {
        review.urls.push({ name: component.name, url: transport.url });
      }
    } else if (component.kind === 'skill') {
      await collectScripts(fs, component.dir, '', 0, scripts);
    }
  }
  review.scripts = [...scripts].sort();
  return review;
}
