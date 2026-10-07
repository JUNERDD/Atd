import { lstat, mkdir, readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { errorMessage } from '@atd/agent-contracts';
import { isItemName } from '@atd/plugin-kit';
import { writeTextAtomic } from '../config.js';
import { ConflictError } from '../errors.js';
import { atdAgentsDir, inside } from '../service-fs.js';

const TOOLS = new Set(['read', 'write', 'edit', 'bash', 'command']);
const MAX_DESCRIPTION = 2048;
const MAX_PROMPT = 16000;
const MAX_MODEL = 256;
const MAX_DIAGNOSTICS = 64;
/** Item names are at most this long (`isItemName`); diagnostics cut longer declared names to it. */
const MAX_NAME = 128;

export interface AtdAgent {
  name: string;
  description: string;
  tools: string[];
  model: string | null;
  systemPrompt: string;
}

/**
 * A `<atdHome>/agents` file that did not load, and why. `agent` is the name it would load under
 * (its frontmatter name, else its file name), so a reference to that name can say why it is
 * unavailable (references/agents.ts).
 */
export interface AtdAgentDiagnostic {
  type: 'warning';
  code: 'invalid_agent';
  message: string;
  agent: string;
  path: string;
}

/** The markdown specialists that loaded, and the files that did not. */
export interface AtdAgentCatalog {
  agents: AtdAgent[];
  diagnostics: AtdAgentDiagnostic[];
}

type AgentFrontmatter = {
  name?: unknown;
  description?: unknown;
  tools?: unknown;
  model?: unknown;
};

/** One file: its agent, or the name it would load under and why it cannot. */
type AgentFile = { agent: AtdAgent } | { name: string; problem: string };

/** The catalog folder: its path, its real path and its `.md` file names in order. */
interface CatalogDir {
  root: string;
  real: string;
  files: string[];
}

/** Lists markdown specialists from `<atdHome>/agents/*.md` only (service-fs.ts `atdHome`). */
export async function listAtdAgents(): Promise<AtdAgentCatalog> {
  const catalog: AtdAgentCatalog = { agents: [], diagnostics: [] };
  const dir = await catalogDir();
  if (!dir) return catalog;
  for (const fileName of dir.files) {
    const filePath = path.join(dir.root, fileName);
    const file = await readAgentFile(dir, fileName);
    if ('agent' in file) catalog.agents.push(file.agent);
    else if (catalog.diagnostics.length < MAX_DIAGNOSTICS)
      catalog.diagnostics.push({
        type: 'warning',
        code: 'invalid_agent',
        message: `Agent file "${fileName}" was skipped: ${file.problem}.`,
        agent: file.name.slice(0, MAX_NAME),
        path: filePath.slice(0, 4096),
      });
  }
  return catalog;
}

/**
 * Writes one agent markdown file under `<atdHome>/agents`. Names are bare item names: the file
 * name is the agent name, and qualified `<plugin>:<item>` names belong to installed plugins. A
 * save never replaces another agent: when `<name>.md` defines a different one (by its frontmatter
 * name, valid or not), it is refused as a conflict. The new file replaces the entry at that name,
 * so a link there is never written through.
 */
export async function putAtdAgent(input: {
  name: string;
  description: string;
  tools: string[];
  model: string | null;
  systemPrompt: string;
}): Promise<{ agent: AtdAgent }> {
  const name = input.name.trim();
  if (!isItemName(name)) {
    throw new TypeError(
      `Agent name "${name}" must be 1–128 letters, digits, "-" or "_", starting with a letter or digit.`,
    );
  }
  const description = input.description.trim();
  const systemPrompt = input.systemPrompt.trim();
  if (!description || description.length > MAX_DESCRIPTION) {
    throw new Error(`Agent description must be 1–${MAX_DESCRIPTION} characters.`);
  }
  if (!systemPrompt || systemPrompt.length > MAX_PROMPT) {
    throw new Error(`Agent system prompt must be 1–${MAX_PROMPT} characters.`);
  }
  const model =
    input.model === null || input.model === undefined
      ? null
      : (() => {
          const value = input.model.trim();
          if (!value) return null;
          if (value.length > MAX_MODEL)
            throw new Error(`Agent model must be at most ${MAX_MODEL} characters.`);
          return value;
        })();
  const tools = normalizeTools(input.tools);
  const agent: AtdAgent = { name, description, tools, model, systemPrompt };
  const fileName = `${name}.md`;
  await mkdir(atdAgentsDir(), { recursive: true });
  const dir = await catalogDir();
  const replaced = dir && (await replacedAgent(dir, fileName));
  if (replaced && replaced !== name)
    throw new ConflictError(
      `~/.atd/agents/${fileName} defines the agent "${replaced}"; saving "${name}" would replace it. Rename or delete that file first.`,
    );
  await writeTextAtomic(path.join(atdAgentsDir(), fileName), formatAgentMarkdown(agent), 0o644);
  return { agent };
}

/**
 * Deletes every `<atdHome>/agents` file that loads as `name`. A file's frontmatter name wins over
 * its file name, so the files are matched by what they parse to, not by `<name>.md`. A file that
 * does not load is kept: the catalog reports it, with why, for the user to fix. Returns whether
 * any file was removed.
 */
export async function deleteAtdAgent(name: string): Promise<boolean> {
  const dir = await catalogDir();
  if (!dir) return false;
  let deleted = false;
  for (const fileName of dir.files) {
    const file = await readAgentFile(dir, fileName);
    if (!('agent' in file) || file.agent.name !== name) continue;
    await rm(path.join(dir.root, fileName), { force: true });
    deleted = true;
  }
  return deleted;
}

/** The catalog folder with its `.md` files by name; null when it does not exist. */
async function catalogDir(): Promise<CatalogDir | null> {
  const root = atdAgentsDir();
  try {
    const files = (await readdir(root)).filter((name) => name.endsWith('.md')).sort();
    return { root, real: await realpath(root), files };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Reads and checks one file. Never throws, so one broken file cannot hide or block the others. */
async function readAgentFile(dir: CatalogDir, fileName: string): Promise<AgentFile> {
  const filePath = path.join(dir.root, fileName);
  const fromFile = fileName.replace(/\.md$/i, '');
  let content: string;
  let linked: string | null;
  try {
    content = await readFile(filePath, 'utf8');
    linked = await linkProblem(dir, filePath);
  } catch (error) {
    return { name: fromFile, problem: `it could not be read (${errorMessage(error)})` };
  }
  let file: AgentFile;
  try {
    file = parseAgentMarkdown(content, fromFile);
  } catch (error) {
    // parseFrontmatter throws on frontmatter that is not YAML.
    return {
      name: fromFile,
      problem: `its frontmatter is not valid YAML (${errorMessage(error)})`,
    };
  }
  if (!linked) return file;
  return { name: 'agent' in file ? file.agent.name : file.name, problem: linked };
}

/**
 * Why a file may not load for how it is linked. Through a symbolic link out of the catalog or a
 * hard link, a write to another path would change the agent without the confirm every write into
 * the catalog asks (catalog-writes.ts). The catalog folder itself may be a link.
 */
async function linkProblem(dir: CatalogDir, filePath: string): Promise<string | null> {
  const real = await realpath(filePath);
  if (!inside(dir.real, real)) return 'it links to a file outside ~/.atd/agents';
  if ((await stat(real)).nlink > 1) return 'it has more than one hard link';
  return null;
}

/**
 * The agent the file a save of `fileName` would replace defines, or would define once valid; null
 * when there is none. That file is found by its directory entry, so on a case-insensitive file
 * system a file whose name differs only in case still counts.
 */
async function replacedAgent(dir: CatalogDir, fileName: string): Promise<string | null> {
  const target = await lstat(path.join(dir.root, fileName)).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
  if (!target) return null;
  for (const entry of dir.files) {
    const stats = await lstat(path.join(dir.root, entry));
    if (stats.ino !== target.ino || stats.dev !== target.dev) continue;
    const file = await readAgentFile(dir, entry);
    return 'agent' in file ? file.agent.name : file.name;
  }
  return null;
}

function parseAgentMarkdown(content: string, fromFile: string): AgentFile {
  const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);
  const declared = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '';
  const name = declared || fromFile;
  const invalid = (problem: string): AgentFile => ({ name, problem });
  if (!isItemName(name))
    return invalid(
      `its name "${name.slice(0, MAX_NAME)}" must be 1–${MAX_NAME} letters, digits, "-" or "_", starting with a letter or digit`,
    );
  if (typeof frontmatter.description !== 'string' || !frontmatter.description.trim())
    return invalid('it has no description');
  const description = frontmatter.description.trim().slice(0, MAX_DESCRIPTION);
  const systemPrompt = body.trim();
  if (!systemPrompt || systemPrompt.length > MAX_PROMPT)
    return invalid(`its system prompt must be 1–${MAX_PROMPT} characters`);
  const tools = parseTools(frontmatter.tools);
  if ('problem' in tools) return invalid(tools.problem);
  const model =
    typeof frontmatter.model === 'string' && frontmatter.model.trim()
      ? frontmatter.model.trim().slice(0, MAX_MODEL)
      : null;
  return { agent: { name, description, tools: tools.tools, model, systemPrompt } };
}

function formatAgentMarkdown(agent: AtdAgent): string {
  const lines = ['---', `name: ${agent.name}`, `description: ${yamlScalar(agent.description)}`];
  if (agent.tools.length) lines.push(`tools: ${agent.tools.join(', ')}`);
  if (agent.model) lines.push(`model: ${yamlScalar(agent.model)}`);
  lines.push('---', '', agent.systemPrompt, '');
  return lines.join('\n');
}

function yamlScalar(value: string): string {
  if (/[:#{}[\],&*!|>'"%@`]/.test(value) || value.includes('\n')) {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * A file's `tools`, as a comma-separated or YAML list. Absent or blank names none, so the run's
 * child ceiling decides (subagents/agents.ts). Any other value, or a name a Settings save would
 * refuse (`normalizeTools`), makes the file invalid: dropping it could leave the list empty, which
 * would widen the agent to every tool the run allows.
 */
function parseTools(value: unknown): { tools: string[] } | { problem: string } {
  if (value === undefined || value === null) return { tools: [] };
  const listed: unknown[] | null =
    typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : null;
  if (!listed || !listed.every((tool): tool is string => typeof tool === 'string'))
    return { problem: 'its tools must be a comma-separated list or a YAML list of tool names' };
  // Blank entries, such as the one a trailing comma leaves, name nothing.
  const checked = checkTools(listed.map((tool) => tool.trim()).filter(Boolean));
  if ('unsupported' in checked)
    return {
      problem: `its tools include "${checked.unsupported}", which is not one of ${[...TOOLS].join(', ')}`,
    };
  return checked;
}

/** The tools a list names, lowercased and without repeats, or the first one that is unsupported. */
function checkTools(tools: readonly string[]): { tools: string[] } | { unsupported: string } {
  const seen = new Set<string>();
  for (const tool of tools) {
    const name = tool.trim().toLowerCase();
    if (!TOOLS.has(name)) return { unsupported: tool };
    seen.add(name);
  }
  return { tools: [...seen] };
}

function normalizeTools(tools: readonly string[]): string[] {
  const checked = checkTools(tools);
  if ('unsupported' in checked) throw new Error(`Unsupported agent tool "${checked.unsupported}".`);
  return checked.tools;
}
