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
import { SettingsStore } from '../settings/store.js';
import { withoutLegacySelection } from './legacy-selection.js';
import { assertShortcutFree, withCanonicalShortcut } from './shortcuts.js';
import { validateCommandShape } from './templates.js';

/**
 * Service-owned command store (T6b live surface over the T2 `commands.json`).
 * Create assigns identity; updates are full-replace with an expected-revision
 * guard (next-version edits, never a hot-swap: accepted runs already froze
 * their resolved instructions). Unknown extension fields round-trip.
 * Every write stores a canonical shortcut no app action or other enabled
 * command holds (`shortcuts.ts`), for routes and the Agent's tool alike.
 * Legacy `skills`/`roleId` keys are folded into instructions on load and on
 * every write (`legacy-selection.ts`). The load keeps the revision: the fold
 * is deterministic, so the file converges with the next write of any command.
 */
export class CommandStore {
  private chain: Promise<void> = Promise.resolve();

  /** Change listeners by store file; instances load per call, so listeners live on the class. */
  private static readonly watchers = new Map<string, Set<() => void>>();

  /**
   * Calls `listener` after every write to the command store of `dataDir`, whether a route or the
   * Agent's `command` tool made it, so clients hear about both. Answers the unsubscribe.
   */
  static onChanged(dataDir: string, listener: () => void): () => void {
    const file = commandsFile(dataDir);
    const listeners = CommandStore.watchers.get(file) ?? new Set();
    listeners.add(listener);
    CommandStore.watchers.set(file, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) CommandStore.watchers.delete(file);
    };
  }

  /**
   * Tells `onChanged` listeners that the command list changed without a store write: an
   * installed plugin's command was turned on or off, or a plugin came or went.
   */
  static announce(dataDir: string): void {
    for (const listener of CommandStore.watchers.get(commandsFile(dataDir)) ?? []) listener();
  }

  private constructor(
    private readonly dataDir: string,
    private readonly file: string,
    public data: ServiceCommandsFile,
  ) {}

  static async load(dataDir: string): Promise<CommandStore> {
    const file = commandsFile(dataDir);
    try {
      if ((await stat(file)).size > 8 * 1024 * 1024) throw new Error('Commands file is too large.');
      const data = parse(ServiceCommandsFileSchema, JSON.parse(await readFile(file, 'utf8')));
      return new CommandStore(dataDir, file, {
        ...data,
        commands: data.commands.map(withoutLegacySelection),
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return new CommandStore(dataDir, file, { version: 1, commands: [] });
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
      for (const listener of CommandStore.watchers.get(this.file) ?? []) listener();
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

  /**
   * The command a create would store: defaults filled, identity assigned (a draft without `id`
   * gets a fresh one), shape and templates validated. Throws TypeError on invalid drafts.
   */
  static compose(draft: CommandCreate): ServiceCommandFull {
    const full = parse(
      ServiceCommandFullSchema,
      withoutLegacySelection({
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
        ...withCanonicalShortcut(draft),
        migratedAt: null,
      }),
    );
    validateCommandShape(full);
    return full;
  }

  /**
   * Throws a ConflictError when the app or another enabled command holds `command`'s shortcut;
   * lets a caller refuse before asking the user to approve a save. Writes check it again.
   */
  async assertShortcutFree(
    command: ServiceCommandFull,
    commands: ServiceCommand[] = this.data.commands,
  ): Promise<void> {
    const stored = commands.map((item) => parse(ServiceCommandFullSchema, item));
    assertShortcutFree(command, stored, await SettingsStore.readShortcuts(this.dataDir));
  }

  async create(draft: CommandCreate): Promise<ServiceCommandFull> {
    const full = CommandStore.compose(draft);
    return this.change(async (data) => {
      if (data.commands.some((command) => command.id === full.id))
        throw new ConflictError(`Command ${full.id} already exists.`);
      await this.assertShortcutFree(full, data.commands);
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
    command = withCanonicalShortcut(withoutLegacySelection(command));
    validateCommandShape(command);
    return this.change(async (data) => {
      const index = data.commands.findIndex((item) => item.id === id);
      const live = data.commands.find((item) => item.id === id);
      if (index < 0 || !live) throw new LedgerNotFound('Command', id);
      if (live.revision !== expectedRevision)
        throw new ConflictError('This command changed. Reload before saving.');
      await this.assertShortcutFree(command, data.commands);
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
