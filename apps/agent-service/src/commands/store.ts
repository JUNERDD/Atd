import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import {
  parse,
  ServiceCommandFullSchema,
  ServiceCommandsFileSchema,
  type CommandCreate,
  type ServiceCommand,
  type ServiceCommandFull,
  type ServiceCommandsFile,
} from '@ai/agent-contracts';
import { atomicWrite } from '../config.js';
import { ConflictError } from '../errors.js';
import { LedgerNotFound } from '../ledger.js';
import { commandsFile } from '../migration/import-tasks.js';
import { validateCommandShape } from './templates.js';

/**
 * Service-owned command store (T6b live surface over the T2 `commands.json`).
 * Create assigns identity; updates are full-replace with an expected-revision
 * guard (next-version edits, never a hot-swap: accepted runs already froze
 * their resolved instructions). Unknown extension fields round-trip.
 */
export class CommandStore {
  private chain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly file: string,
    public data: ServiceCommandsFile,
  ) {}

  static async load(dataDir: string): Promise<CommandStore> {
    const file = commandsFile(dataDir);
    try {
      if ((await stat(file)).size > 8 * 1024 * 1024) throw new Error('Commands file is too large.');
      return new CommandStore(
        file,
        parse(ServiceCommandsFileSchema, JSON.parse(await readFile(file, 'utf8'))),
      );
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return new CommandStore(file, { version: 1, commands: [] });
      throw new Error('Saved service commands could not be read. The file is preserved.');
    }
  }

  /** Serializes mutations; publishes only after the atomic write lands. */
  change<T>(update: (draft: ServiceCommandsFile) => T | Promise<T>): Promise<T> {
    const operation = this.chain.then(async () => {
      const draft = structuredClone(this.data);
      const result = await update(draft);
      await atomicWrite(this.file, parse(ServiceCommandsFileSchema, draft));
      this.data = draft;
      return result;
    });
    this.chain = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  list(): ServiceCommandFull[] {
    return [...this.data.commands]
      .map((command) => parse(ServiceCommandFullSchema, command))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Normalizes a validated full command to the persisted store shape. Spread
   * properties are exempt from excess checks, so validated extension fields
   * round-trip through the additionalProperties:true store file.
   */
  private static storable(full: ServiceCommandFull): ServiceCommand {
    return { ...full, migratedAt: full.migratedAt ?? null };
  }

  get(id: string): ServiceCommandFull {
    const found = this.data.commands.find((command) => command.id === id);
    if (!found) throw new LedgerNotFound('Command', id);
    return parse(ServiceCommandFullSchema, found);
  }

  async create(draft: CommandCreate): Promise<ServiceCommandFull> {
    const full = parse(ServiceCommandFullSchema, {
      id: draft.id ?? randomUUID(),
      revision: 1,
      description: '',
      enabled: true,
      shortcut: '',
      templateId: null,
      input: {
        source: 'manual',
        required: false,
        files: false,
        selection: false,
        clipboard: false,
      },
      parameters: [],
      model: { mode: 'inherit' },
      tools: [],
      memory: 'inherit',
      ...draft,
      migratedAt: null,
    });
    validateCommandShape(full);
    return this.change((data) => {
      if (data.commands.some((command) => command.id === full.id))
        throw new ConflictError(`Command ${full.id} already exists.`);
      data.commands.push(CommandStore.storable(full));
      return full;
    });
  }

  async update(
    id: string,
    command: ServiceCommandFull,
    expectedRevision: number,
  ): Promise<ServiceCommandFull> {
    if (command.id !== id) throw new TypeError('Invalid data: path id and command id differ.');
    validateCommandShape(command);
    return this.change((data) => {
      const index = data.commands.findIndex((item) => item.id === id);
      const live = data.commands.find((item) => item.id === id);
      if (index < 0 || !live) throw new LedgerNotFound('Command', id);
      if (live.revision !== expectedRevision)
        throw new ConflictError('This command changed. Reload before saving.');
      const next = parse(ServiceCommandFullSchema, {
        ...command,
        revision: live.revision + 1,
        migratedAt: live.migratedAt ?? command.migratedAt ?? null,
      });
      data.commands[index] = CommandStore.storable(next);
      return next;
    });
  }

  async remove(id: string, expectedRevision: number): Promise<void> {
    await this.change((data) => {
      const live = data.commands.find((item) => item.id === id);
      if (!live) throw new LedgerNotFound('Command', id);
      if (live.revision !== expectedRevision)
        throw new ConflictError('This command changed. Reload before deleting.');
      data.commands = data.commands.filter((item) => item.id !== id);
    });
  }
}
