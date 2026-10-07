import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Compile } from 'typebox/compile';
import { AppDiagnosticSchema, type AppDiagnostic } from '@atd/agent-contracts';
import type { AppPaths } from './paths.js';

/** Lines kept in an app's `diagnostics.jsonl`; older ones fall off. */
export const DIAGNOSTICS_RING = 200;

const DiagnosticValidator = Compile(AppDiagnosticSchema);

export type DiagnosticInput = Omit<AppDiagnostic, 'at'> & { at?: string };

/**
 * Each app's diagnostics ring: build and typecheck failures, frontend errors the shell reports,
 * backend logs, stderr and crashes, and rejected widget renders. Writes per app are serialized
 * and rewrite the file with the newest `DIAGNOSTICS_RING` lines; a line that does not parse is
 * dropped on the next write. Write failures are swallowed: diagnostics never fail the operation
 * they describe.
 */
export class AppDiagnostics {
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly paths: AppPaths) {}

  append(appId: string, entries: DiagnosticInput[]): Promise<void> {
    if (!entries.length) return Promise.resolve();
    const now = new Date().toISOString();
    const lines = entries.map((entry) => clamp({ ...entry, at: entry.at ?? now }));
    const previous = this.chains.get(appId) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        const kept = [...(await this.read(appId)), ...lines].slice(-DIAGNOSTICS_RING);
        const file = this.paths.diagnostics(appId);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, kept.map((line) => JSON.stringify(line)).join('\n') + '\n', {
          mode: 0o600,
        });
      })
      .catch(() => undefined);
    this.chains.set(appId, next);
    return next;
  }

  /** The ring, oldest first. */
  async read(appId: string): Promise<AppDiagnostic[]> {
    let text: string;
    try {
      text = await readFile(this.paths.diagnostics(appId), 'utf8');
    } catch {
      return [];
    }
    return text.split('\n').flatMap((line) => {
      if (!line.trim()) return [];
      try {
        const value: unknown = JSON.parse(line);
        return DiagnosticValidator.Check(value) ? [value] : [];
      } catch {
        return [];
      }
    });
  }
}

/** Bounds the free text to the contract's limits. */
function clamp(entry: AppDiagnostic): AppDiagnostic {
  return {
    ...entry,
    message: entry.message.slice(0, 4000),
    ...(entry.detail !== undefined ? { detail: entry.detail.slice(0, 16000) } : {}),
  };
}
