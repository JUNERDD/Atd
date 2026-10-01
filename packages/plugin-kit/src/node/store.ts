import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { isPluginName } from '../model/names.js';
import {
  PluginRegistryFileSchema,
  PluginStateFileSchema,
  type PluginRegistryFile,
  type PluginStateFile,
} from '../model/records.js';

/** Revisions each active run froze (`refs.json`); GC keeps every revision listed here. */
export const PluginRefsFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    runs: Type.Record(
      Type.String(),
      Type.Array(
        Type.Object(
          { id: Type.String(), revision: Type.String() },
          { additionalProperties: false },
        ),
      ),
    ),
  },
  { additionalProperties: false },
);
export type PluginRefsFile = Static<typeof PluginRefsFileSchema>;

/** A registry, state, refs or preview file exists but is unreadable; it is left untouched. */
export class PluginStoreError extends Error {
  constructor(
    readonly file: string,
    detail: string,
  ) {
    super(`${file} is malformed and was left unchanged: ${detail}`);
    this.name = 'PluginStoreError';
  }
}

const REVISION_PATTERN = /^[0-9a-f]{16,64}$/;

/** Absolute locations inside the installer root. Ids and revisions are validated before use. */
export function storePaths(root: string) {
  const pluginDir = (base: string, id: string) => {
    if (!isPluginName(id)) throw new Error(`"${id}" is not an installable plugin id.`);
    return path.join(root, base, id);
  };
  return {
    registry: path.join(root, 'registry.json'),
    state: path.join(root, 'state.json'),
    refs: path.join(root, 'refs.json'),
    revisions: path.join(root, 'revisions'),
    staging: path.join(root, 'staging'),
    pluginRevisions: (id: string) => pluginDir('revisions', id),
    revision(id: string, revision: string) {
      if (!REVISION_PATTERN.test(revision)) throw new Error(`"${revision}" is not a revision.`);
      return path.join(pluginDir('revisions', id), revision);
    },
    data: (id: string) => pluginDir('data', id),
  };
}
export type StorePaths = ReturnType<typeof storePaths>;

/** Reads and validates a JSON file; a missing file yields `empty()`. */
export async function readJsonFile<S extends TSchema, E = Static<S>>(
  file: string,
  schema: S,
  empty: () => E,
): Promise<Static<S> | E> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty();
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new PluginStoreError(file, (error as Error).message);
  }
  if (!Value.Check(schema, value)) {
    const [first] = [...Value.Errors(schema, value)];
    throw new PluginStoreError(file, first ? `${first.instancePath} ${first.message}` : 'invalid');
  }
  return value as Static<S>;
}

/** Writes JSON through a synced temporary file and a rename, so readers never see a torn file. */
export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'w');
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export const emptyRegistry = (): PluginRegistryFile => ({ version: 1, plugins: [] });
export const emptyState = (): PluginStateFile => ({
  version: 1,
  disabled: [],
  items: {},
  config: {},
});
export const emptyRefs = (): PluginRefsFile => ({ version: 1, runs: {} });

/** Typed access to the three installer files. Callers serialize read-modify-write cycles. */
export function createStore(paths: StorePaths) {
  return {
    readRegistry: () => readJsonFile(paths.registry, PluginRegistryFileSchema, emptyRegistry),
    writeRegistry: (value: PluginRegistryFile) => writeJsonFile(paths.registry, value),
    readState: () => readJsonFile(paths.state, PluginStateFileSchema, emptyState),
    writeState: (value: PluginStateFile) => writeJsonFile(paths.state, value),
    readRefs: () => readJsonFile(paths.refs, PluginRefsFileSchema, emptyRefs),
    writeRefs: (value: PluginRefsFile) => writeJsonFile(paths.refs, value),
    /** Applies `change` to a fresh copy of the state and writes it. */
    async updateState(change: (state: PluginStateFile) => void): Promise<void> {
      const state = await readJsonFile(paths.state, PluginStateFileSchema, emptyState);
      change(state);
      await writeJsonFile(paths.state, state);
    },
  };
}
export type Store = ReturnType<typeof createStore>;
