import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { isItemName } from '@ai/plugin-kit';
import { atdAgentsDir } from '../service-fs.js';

const TOOLS = new Set(['read', 'write', 'edit', 'bash', 'command']);
const MAX_DESCRIPTION = 2048;
const MAX_PROMPT = 16000;
const MAX_MODEL = 256;
const MAX_DIAGNOSTICS = 64;

export interface AtdAgent {
  name: string;
  description: string;
  tools: string[];
  model: string | null;
  systemPrompt: string;
}

export interface AtdAgentDiagnostic {
  type: 'warning';
  code: 'invalid_skill';
  message: string;
  path?: string;
}

type AgentFrontmatter = {
  name?: unknown;
  description?: unknown;
  tools?: unknown;
  model?: unknown;
};

/** Lists markdown specialists from `<atdHome>/agents/*.md` only (service-fs.ts `atdHome`). */
export async function listAtdAgents(): Promise<{
  agents: AtdAgent[];
  diagnostics: AtdAgentDiagnostic[];
}> {
  const root = atdAgentsDir();
  const diagnostics: AtdAgentDiagnostic[] = [];
  let entries: string[];
  try {
    entries = (await readdir(root)).filter((name) => name.endsWith('.md')).sort();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { agents: [], diagnostics: [] };
    }
    throw error;
  }
  const agents: AtdAgent[] = [];
  for (const fileName of entries) {
    const filePath = path.join(root, fileName);
    try {
      const content = await readFile(filePath, 'utf8');
      const agent = parseAgentMarkdown(content, fileName);
      if (agent) agents.push(agent);
      else
        pushDiagnostic(diagnostics, {
          type: 'warning',
          code: 'invalid_skill',
          message: `Agent file "${fileName}" has invalid frontmatter and was skipped.`,
          path: filePath.slice(0, 4096),
        });
    } catch (error) {
      pushDiagnostic(diagnostics, {
        type: 'warning',
        code: 'invalid_skill',
        message: error instanceof Error ? error.message : `Agent "${fileName}" could not be read.`,
        path: filePath.slice(0, 4096),
      });
    }
  }
  return { agents, diagnostics };
}

/**
 * Writes one agent markdown file under `<atdHome>/agents`. Names are bare item names: the file
 * name is the agent name, and qualified `<plugin>:<item>` names belong to installed plugins.
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
  const root = atdAgentsDir();
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, `${name}.md`), formatAgentMarkdown(agent), 'utf8');
  return { agent };
}

/**
 * Deletes every `<atdHome>/agents` file that defines `name`. A file's frontmatter name wins over
 * its file name, so the files are matched by what they parse to, not by `<name>.md`. Returns
 * whether any file was removed.
 */
export async function deleteAtdAgent(name: string): Promise<boolean> {
  const root = atdAgentsDir();
  let entries: string[];
  try {
    entries = (await readdir(root)).filter((fileName) => fileName.endsWith('.md'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
  let deleted = false;
  for (const fileName of entries) {
    const filePath = path.join(root, fileName);
    const agent = parseAgentMarkdown(await readFile(filePath, 'utf8'), fileName);
    if (agent?.name !== name) continue;
    await rm(filePath, { force: true });
    deleted = true;
  }
  return deleted;
}

function parseAgentMarkdown(content: string, fileName: string): AtdAgent | null {
  const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);
  const fromFile = fileName.replace(/\.md$/i, '');
  const name =
    typeof frontmatter.name === 'string' && frontmatter.name.trim()
      ? frontmatter.name.trim()
      : fromFile;
  if (!isItemName(name)) return null;
  if (typeof frontmatter.description !== 'string' || !frontmatter.description.trim()) return null;
  const description = frontmatter.description.trim().slice(0, MAX_DESCRIPTION);
  const systemPrompt = body.trim();
  if (!systemPrompt || systemPrompt.length > MAX_PROMPT) return null;
  const model =
    typeof frontmatter.model === 'string' && frontmatter.model.trim()
      ? frontmatter.model.trim().slice(0, MAX_MODEL)
      : null;
  return {
    name,
    description,
    tools: normalizeTools(parseToolList(frontmatter.tools)),
    model,
    systemPrompt: systemPrompt.slice(0, MAX_PROMPT),
  };
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

function parseToolList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return raw
    .filter((tool): tool is string => typeof tool === 'string')
    .map((tool) => tool.trim().toLowerCase())
    .filter((tool) => TOOLS.has(tool));
}

function normalizeTools(tools: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const tool of tools) {
    const name = tool.trim().toLowerCase();
    if (!TOOLS.has(name)) throw new Error(`Unsupported agent tool "${tool}".`);
    seen.add(name);
  }
  return [...seen];
}

function pushDiagnostic(diagnostics: AtdAgentDiagnostic[], diagnostic: AtdAgentDiagnostic): void {
  if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(diagnostic);
}
