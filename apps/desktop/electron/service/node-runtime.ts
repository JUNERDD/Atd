import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Must match `@ai/agent-service` `engines.node` (root-aligned). Used when the
 * bundled service package.json is missing. Never treat Electron as Node.
 */
export const DEFAULT_NODE_ENGINES = '^24.15.0 || >=26.0.0';

export interface NodeTriple {
  major: number;
  minor: number;
  patch: number;
}

export function parseNodeVersion(raw: string): NodeTriple {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
  if (!match) throw new Error(`Unrecognized Node.js version: ${raw.trim() || '(empty)'}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareNode(left: NodeTriple, right: NodeTriple): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

function clauseMatches(version: NodeTriple, clause: string): boolean {
  const trimmed = clause.trim();
  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
  if (caret) {
    const min = { major: Number(caret[1]), minor: Number(caret[2]), patch: Number(caret[3]) };
    const nextMajor = { major: min.major + 1, minor: 0, patch: 0 };
    return compareNode(version, min) >= 0 && compareNode(version, nextMajor) < 0;
  }
  const gte = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
  if (gte) {
    const min = { major: Number(gte[1]), minor: Number(gte[2]), patch: Number(gte[3]) };
    return compareNode(version, min) >= 0;
  }
  throw new Error(`Unsupported engines.node clause: ${clause}`);
}

export function nodeSatisfiesEngines(found: string, range: string): boolean {
  const version = parseNodeVersion(found);
  return range.split('||').some((clause) => clauseMatches(version, clause));
}

export function nodeRequirementError(required: string, found: string): Error {
  return new Error(
    `Node.js ${required} is required. Found: ${found}. Install a matching Node.js from https://nodejs.org and put \`node\` on PATH. The Electron app binary is not Node.js.`,
  );
}

/** GUI apps often have a stripped PATH; keep common system-Node locations. */
export function nodeSearchPath(): string {
  const extras =
    process.platform === 'darwin'
      ? ['/opt/homebrew/bin', '/usr/local/bin']
      : process.platform === 'win32'
        ? []
        : ['/usr/local/bin'];
  return [...extras, process.env.PATH ?? ''].filter(Boolean).join(path.delimiter);
}

export async function readEnginesFromCli(cli: string): Promise<string> {
  try {
    const manifest = path.join(path.dirname(cli), '..', 'package.json');
    const raw: unknown = JSON.parse(await readFile(manifest, 'utf8'));
    if (
      raw &&
      typeof raw === 'object' &&
      'engines' in raw &&
      raw.engines &&
      typeof raw.engines === 'object' &&
      'node' in raw.engines &&
      typeof raw.engines.node === 'string'
    )
      return raw.engines.node;
  } catch {
    // Fall back to the workspace range.
  }
  return DEFAULT_NODE_ENGINES;
}

/**
 * Resolves system `node` (never `process.execPath`). Parses `node --version`
 * and compares it to engines. No download.
 */
export async function resolveSystemNode(required: string): Promise<string> {
  const env = { ...process.env, PATH: nodeSearchPath() };
  try {
    const { stdout } = await execFileAsync('node', ['--version'], { encoding: 'utf8', env });
    const found = stdout.trim() || '(empty)';
    if (!nodeSatisfiesEngines(found, required)) throw nodeRequirementError(required, found);
    return 'node';
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Node.js ')) throw error;
    const detail = error instanceof Error ? error.message : 'missing';
    throw nodeRequirementError(required, `missing (${detail})`);
  }
}
