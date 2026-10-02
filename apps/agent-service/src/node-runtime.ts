import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Workspace toolchain range (root `engines.node`). Pi 1.0.0 needs ≥22.19.0;
 * this range is a strict subset and matches what we typecheck/build against.
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
    `Node.js ${required} is required. Found: ${found}. Install a matching Node.js from https://nodejs.org and put \`node\` on PATH.`,
  );
}

export function readServiceManifest(fromDir = path.dirname(fileURLToPath(import.meta.url))): {
  version: string;
  engines: string;
} {
  const raw: unknown = JSON.parse(readFileSync(path.join(fromDir, '..', 'package.json'), 'utf8'));
  if (!raw || typeof raw !== 'object') throw new Error('Invalid agent-service package.json.');
  const record = raw as { version?: unknown; engines?: { node?: unknown } };
  const version = typeof record.version === 'string' ? record.version : '0.0.0';
  const engines =
    typeof record.engines?.node === 'string' ? record.engines.node : DEFAULT_NODE_ENGINES;
  return { version, engines };
}

export function assertSupportedNode(): void {
  const { engines } = readServiceManifest();
  if (!nodeSatisfiesEngines(process.version, engines))
    throw nodeRequirementError(engines, process.version);
}
