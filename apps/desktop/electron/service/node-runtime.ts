import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

// `scripts/prepare-service-pack.mjs` imports this file directly through Node's
// type stripping to check the bundled Node version, so it must keep erasable
// TypeScript syntax only and import nothing but Node built-ins.

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

/**
 * `base` (the login-shell PATH, or the app's own when the shell could not answer) followed by the
 * common system-Node locations it lacks, so a stripped GUI PATH still finds a Homebrew or
 * /usr/local install. `base` keeps its order: the user's own toolchain comes first.
 */
export function nodeSearchPath(base: string): string {
  const extras =
    process.platform === 'darwin'
      ? ['/opt/homebrew/bin', '/usr/local/bin']
      : process.platform === 'win32'
        ? []
        : ['/usr/local/bin'];
  const entries = base.split(path.delimiter).filter(Boolean);
  return [...entries, ...extras.filter((extra) => !entries.includes(extra))].join(path.delimiter);
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
 * Resolves system `node` (never `process.execPath`) on `searchPath`, the PATH the service is
 * spawned with, so the checked `node` is the one that runs. Parses `node --version` and compares
 * it to engines. No download.
 */
export async function resolveSystemNode(required: string, searchPath: string): Promise<string> {
  const env = { ...process.env, PATH: searchPath };
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

/** The Node executable that runs the service, and the directory that carries it. */
export interface ServiceNode {
  /** Executable to spawn. */
  command: string;
  /**
   * Directory the launcher appends last to the child's PATH, so a bare `node` falls back to
   * `command` only when the user has no Node of their own; null when the system Node is used.
   */
  binDir: string | null;
}

/**
 * Location of the executable inside the bundled Node root. Mirrors the layout
 * `scripts/prepare-service-pack.mjs` stages from the official release archive.
 */
function bundledNodeCommand(root: string): string {
  return process.platform === 'win32'
    ? path.join(root, 'node.exe')
    : path.join(root, 'bin', 'node');
}

/**
 * The bundled Node ships with the app, so a missing, broken, or out-of-range
 * binary means a damaged install. It fails loudly instead of falling back to a
 * system Node the packaged build was never tested against.
 */
async function resolveBundledNode(required: string, root: string): Promise<ServiceNode> {
  const command = bundledNodeCommand(root);
  let found: string;
  try {
    const { stdout } = await execFileAsync(command, ['--version'], { encoding: 'utf8' });
    found = stdout.trim() || '(empty)';
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The Node.js bundled with AI could not run (${command}: ${detail}). Reinstall AI.`,
    );
  }
  if (!nodeSatisfiesEngines(found, required))
    throw new Error(
      `The Node.js bundled with AI is ${found}, but the service requires ${required}. Reinstall AI.`,
    );
  return { command, binDir: path.dirname(command) };
}

/**
 * Packaged builds pass the bundled root (`<resources>/node`) and must use it; unpackaged builds
 * pass null and use the system Node found on `searchPath`.
 */
export async function resolveServiceNode(
  required: string,
  bundledRoot: string | null,
  searchPath: string,
): Promise<ServiceNode> {
  if (bundledRoot !== null) return resolveBundledNode(required, bundledRoot);
  return { command: await resolveSystemNode(required, searchPath), binDir: null };
}
