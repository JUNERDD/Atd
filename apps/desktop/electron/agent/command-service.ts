import { clipboard, globalShortcut } from 'electron';
import SelectionHook from 'selection-hook';
import { effectiveAccelerator, parseAccelerator } from '../settings-shortcuts';
import type { ShortcutBindings } from '../settings-contract';
import type { CommandDefinition } from './command-schema';
import type { PreparedCommand } from './bridge';
import { defaultArguments, validateCommand } from './command-validation';
import { emptyInput } from './task-schema';
import { AgentStore } from './store';
import { errorMessage } from './validation';

export class CommandService {
  readonly errors: Record<string, string> = {};
  private selection: SelectionHook | null = null;
  private captured: { text: string; capturedAt: string } | null = null;
  constructor(
    private store: AgentStore,
    private shortcuts: () => ShortcutBindings,
    private launch: (command: PreparedCommand) => void,
  ) {}

  find(id: string) {
    const command = this.store.data.commands.find((command) => command.id === id);
    if (!command)
      throw new Error('This command was deleted. Use its saved version from task history.');
    return command;
  }

  captureSelection() {
    this.captured = null;
    try {
      this.selection ??= new SelectionHook();
      if (!this.selection.isRunning() && !this.selection.start({ enableClipboard: false })) return;
      const text = this.selection.getCurrentSelection()?.text ?? '';
      if (text.trim()) this.captured = { text, capturedAt: new Date().toISOString() };
    } catch {
      /* Unavailable accessibility is reported on the command input screen. */
    } finally {
      this.selection?.stop();
    }
  }

  async capture(source: 'selection' | 'clipboard') {
    if (source === 'selection') {
      if (!this.captured)
        throw new Error(
          'No selected text was captured. Select text in another app and use the command shortcut, or enter text manually. Accessibility permission may be required.',
        );
      if (this.captured.text.length > 100000)
        throw new Error('Selected text exceeds the input limit. Select a smaller passage.');
      return { ...this.captured };
    }
    const text = await clipboard.readText();
    if (!text.trim()) throw new Error('The clipboard does not contain text.');
    if (text.length > 100000) throw new Error('Clipboard text exceeds the input limit.');
    return { text, capturedAt: new Date().toISOString() };
  }

  async prepare(id: string): Promise<PreparedCommand> {
    const command = this.find(id);
    if (!command.enabled) throw new Error('This command is disabled. Enable it in settings.');
    const input = {
      ...emptyInput(),
      source: command.input.source,
      arguments: defaultArguments(command),
    };
    let notice = '';
    for (const source of ['selection', 'clipboard'] as const) {
      if (!command.input[source]) continue;
      try {
        const captured = await this.capture(source);
        input[source] = captured.text;
        if (input.source === source) {
          input.text = captured.text;
          input.capturedAt = captured.capturedAt;
        }
      } catch (error) {
        notice = errorMessage(error);
      }
    }
    return { command: structuredClone(command), input, notice };
  }

  initialize() {
    for (const command of this.store.data.commands) {
      if (!command.enabled || !command.shortcut) continue;
      try {
        this.checkShortcut(command);
        this.register(command);
      } catch (error) {
        this.errors[command.id] = errorMessage(error);
      }
    }
  }

  private checkShortcut(command: CommandDefinition) {
    if (!command.shortcut) return;
    const accelerator = effectiveAccelerator(parseAccelerator(command.shortcut, true));
    const reserved = Object.values(this.shortcuts()).some(
      (value) => effectiveAccelerator(value) === accelerator,
    );
    const duplicate = this.store.data.commands.some(
      (other) =>
        other.id !== command.id &&
        other.enabled &&
        other.shortcut &&
        effectiveAccelerator(other.shortcut) === accelerator,
    );
    if (reserved || duplicate)
      throw new Error('This shortcut is already assigned to another action.');
  }

  assertSettings(shortcuts: ShortcutBindings) {
    for (const value of Object.values(shortcuts)) {
      if (
        this.store.data.commands.some(
          (command) =>
            command.enabled &&
            command.shortcut &&
            effectiveAccelerator(command.shortcut) === effectiveAccelerator(value),
        )
      )
        throw new Error('This shortcut is assigned to a command.');
    }
  }

  private register(command: CommandDefinition) {
    const success = globalShortcut.register(command.shortcut, () => {
      this.captureSelection();
      try {
        void this.prepare(command.id)
          .then((prepared) => this.launch(prepared))
          .catch((error) => {
            this.errors[command.id] = errorMessage(error);
          });
      } catch (error) {
        this.errors[command.id] = errorMessage(error);
      }
    });
    if (!success)
      throw new Error('This global shortcut is unavailable. Choose another combination.');
  }

  async save(command: CommandDefinition, expectedRevision: number) {
    validateCommand(command);
    if (command.shortcut) command.shortcut = parseAccelerator(command.shortcut, true);
    if (command.enabled) this.checkShortcut(command);
    const old = this.store.data.commands.find((item) => item.id === command.id);
    if ((old?.revision ?? 0) !== expectedRevision)
      throw new Error(
        'This command changed in another window. Reload the latest version before saving.',
      );
    const registered = old?.enabled && old.shortcut && !this.errors[old.id] ? old.shortcut : '';
    const next = command.enabled ? command.shortcut : '';
    const same = Boolean(
      registered && next && effectiveAccelerator(registered) === effectiveAccelerator(next),
    );
    if (next && !same) this.register(command);
    const saved = { ...command, revision: expectedRevision + 1 };
    try {
      await this.store.change((data) => {
        const index = data.commands.findIndex((item) => item.id === command.id);
        if ((index < 0 ? 0 : data.commands[index]!.revision) !== expectedRevision)
          throw new Error('This command changed. Reload before saving.');
        if (index < 0) data.commands.push(saved);
        else data.commands[index] = saved;
      });
    } catch (error) {
      if (next && !same) globalShortcut.unregister(next);
      throw error;
    }
    if (registered && !same) globalShortcut.unregister(registered);
    delete this.errors[command.id];
    return saved;
  }

  async delete(id: string, revision: number) {
    const command = this.find(id);
    await this.store.change((data) => {
      if (data.commands.find((item) => item.id === id)?.revision !== revision)
        throw new Error('This command changed. Reload before deleting.');
      data.commands = data.commands.filter((item) => item.id !== id);
    });
    if (command.enabled && command.shortcut && !this.errors[id])
      globalShortcut.unregister(command.shortcut);
    delete this.errors[id];
  }
}
