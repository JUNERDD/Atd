import { createJiti } from 'jiti';
import { Type } from 'typebox';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { MemoryEntrySchema, type MemoryEntry } from './bridge';
import { parse } from './validation';

interface HermesScope {
  canRead: () => boolean;
  canLearn: () => boolean;
  policyVersion: () => number;
  notify: (message: string, kind: 'info' | 'warning' | 'error') => void;
  changed: () => void;
}
interface HermesDesktop {
  extension: (scope: HermesScope) => ExtensionFactory;
  list: () => Promise<unknown>;
  update: (entry: MemoryEntry, content: string) => Promise<unknown>;
  runWithPolicy: <T>(allowed: () => boolean, action: () => Promise<T>) => Promise<T>;
  close: () => void;
}
const ResultSchema = Type.Object({
  success: Type.Boolean(),
  error: Type.Optional(Type.String()),
  warning: Type.Optional(Type.String()),
});

export async function loadHermes(root: string) {
  // Hermes ships TypeScript. Pi uses the same Jiti loader; the versioned patch exposes only host integration.
  const jiti = createJiti(import.meta.url, { moduleCache: true, fsCache: false });
  const module = await jiti.import<{
    createDesktopMemory: (root: string) => Promise<HermesDesktop>;
  }>('pi-hermes-memory/src/desktop.ts');
  const memory = await module.createDesktopMemory(root);
  return {
    ...memory,
    list: async () => parse(Type.Array(MemoryEntrySchema), await memory.list()),
    async update(entry: MemoryEntry, content: string) {
      const result = parse(ResultSchema, await memory.update(entry, content));
      if (!result.success) throw new Error(result.error ?? 'Memory could not be updated.');
      return result.warning ?? '';
    },
  };
}
export type HermesHost = Awaited<ReturnType<typeof loadHermes>>;
