import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import { CommandSchema } from './command-schema';
import { ArtifactSchema, TaskSchema } from './task-schema';
import { initialCommands } from './command-templates';
import { parse } from './validation';

const StoreSchema = Type.Object(
  {
    version: Type.Literal(1),
    commands: Type.Array(CommandSchema),
    tasks: Type.Array(TaskSchema),
    artifacts: Type.Array(ArtifactSchema),
    memoryPaused: Type.Boolean(),
    legacyImported: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type AgentData = Static<typeof StoreSchema>;

/**
 * Commands cached before instruction tokens carried `skills` and `roleId`. The service migrates
 * those into tokens and the next command refresh replaces the cache, so loading drops the keys
 * instead of rejecting the whole file. Stored task runs predate both keys.
 */
function withoutRetiredCommandFields(data: unknown): unknown {
  if (typeof data !== 'object' || data === null || !('commands' in data)) return data;
  if (!Array.isArray(data.commands)) return data;
  const commands = data.commands.map((command: unknown) =>
    typeof command === 'object' && command !== null
      ? Object.fromEntries(
          Object.entries(command).filter(([key]) => key !== 'skills' && key !== 'roleId'),
        )
      : command,
  );
  return { ...data, commands };
}

export async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export class AgentStore {
  private chain: Promise<void> = Promise.resolve();
  private constructor(
    private readonly file: string,
    public data: AgentData,
  ) {}

  static async load(root: string): Promise<AgentStore> {
    const file = path.join(root, 'workspace.json');
    try {
      if ((await stat(file)).size > 64 * 1024 * 1024)
        throw new Error('Task metadata is too large.');
      const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
      return new AgentStore(file, parse(StoreSchema, withoutRetiredCommandFields(raw)));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        const store = new AgentStore(file, {
          version: 1,
          commands: initialCommands(),
          tasks: [],
          artifacts: [],
          memoryPaused: false,
          legacyImported: false,
        });
        await atomicJson(file, store.data);
        return store;
      }
      throw new Error('Saved Agent data could not be read. The original file has been preserved.');
    }
  }

  /** Serialize definition edits and accepted runs; publish only after the atomic write. */
  change<T>(update: (draft: AgentData) => T | Promise<T>): Promise<T> {
    const operation = this.chain.then(async () => {
      const draft = structuredClone(this.data);
      const result = await update(draft);
      await atomicJson(this.file, parse(StoreSchema, draft));
      this.data = draft;
      return result;
    });
    this.chain = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}
