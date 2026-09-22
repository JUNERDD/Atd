import { clipboard, globalShortcut, systemPreferences } from 'electron';
import type { AgentClientOptions } from '@ai/agent-client';
import SelectionHook from 'selection-hook';
import { effectiveAccelerator, parseAccelerator } from '../settings-shortcuts';
import type { ShortcutBindings } from '../settings-contract';
import type { CommandDefinition } from './command-schema';
import type { PreparedCommand } from './bridge';
import { defaultArguments, readyToRun, validateCommand } from './command-validation';
import { deleteRemote, fetchCommands, saveRemote } from './command-remote';
import { notConnected } from './service-manage';
import { emptyInput } from './task-schema';
import { AgentStore } from './store';
import { errorMessage } from './validation';

export class CommandService {
  readonly errors: Record<string, string> = {};
  private selection: SelectionHook | null = null;
  private captured: { text: string; capturedAt: string } | null = null;
  private trustRequested = false;
  constructor(
    private store: AgentStore,
    private shortcuts: () => ShortcutBindings,
    private launch: (command: PreparedCommand, autoRun: boolean) => void,
    private changed: () => void,
    private options: () => AgentClientOptions | null,
  ) {}

  find(id: string) {
    const command = this.store.data.commands.find((command) => command.id === id);
    if (!command)
      throw new Error('This command was deleted. Use its saved version from task history.');
    return command;
  }

  /**
   * macOS blocks reading the selected text until the app is trusted for Accessibility. Ask the OS
   * to show its permission prompt once per launch; capture failures then carry the next steps.
   */
  requestAccessibility() {
    if (process.platform !== 'darwin' || this.trustRequested) return;
    this.trustRequested = true;
    systemPreferences.isTrustedAccessibilityClient(true);
  }

  private accessibilityGranted() {
    if (process.platform !== 'darwin') return true;
    try {
      return systemPreferences.isTrustedAccessibilityClient(false);
    } catch {
      return true;
    }
  }

  captureSelection() {
    this.captured = null;
    this.requestAccessibility();
    try {
      this.selection ??= new SelectionHook();
      if (!this.selection.isRunning() && !this.selection.start({ enableClipboard: false })) return;
      const text = this.selection.getCurrentSelection()?.text ?? '';
      if (text.trim()) this.captured = { text, capturedAt: new Date().toISOString() };
    } catch {
      /* The permission request above and the capture notice cover an unavailable selection read. */
    } finally {
      this.selection?.stop();
    }
  }

  async capture(source: 'selection' | 'clipboard') {
    if (source === 'selection') {
      if (!this.captured) {
        if (!this.accessibilityGranted())
          throw new Error(
            'Enable Accessibility: System Settings → Privacy & Security → Accessibility.',
          );
        throw new Error(
          'No selected text — select text in another app, then use the command shortcut.',
        );
      }
      if (this.captured.text.length > 100000)
        throw new Error('Selected text exceeds the input limit — select a smaller passage.');
      return { ...this.captured };
    }
    const text = await clipboard.readText();
    if (!text.trim()) throw new Error('The clipboard does not contain text.');
    if (text.length > 100000) throw new Error('Clipboard text exceeds the input limit.');
    return { text, capturedAt: new Date().toISOString() };
  }

  /**
   * Builds the draft input for a command, asking for macOS Accessibility access when the command
   * can read the selection. A failed capture only surfaces as a notice when the trigger expected
   * captured text (the global shortcut); opening the command from the panel leaves the field empty
   * for manual input instead of reporting a missing selection.
   */
  async prepare(id: string, expectCapture = false): Promise<PreparedCommand> {
    const command = this.find(id);
    if (!command.enabled) throw new Error('This command is disabled. Enable it in settings.');
    if (command.input.selection) this.requestAccessibility();
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
        if (expectCapture) notice = errorMessage(error);
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

  /** Replaces the local cache from the live command store and rebinds shortcuts. */
  async refreshFromService(): Promise<void> {
    const options = this.options();
    if (!options) return;
    const commands = await fetchCommands(options);
    this.unregisterAll();
    await this.store.change((data) => {
      data.commands = commands;
    });
    this.initialize();
    this.changed();
  }

  private unregisterAll() {
    for (const command of this.store.data.commands) {
      if (command.enabled && command.shortcut && !this.errors[command.id])
        globalShortcut.unregister(command.shortcut);
    }
    for (const id of Object.keys(this.errors)) delete this.errors[id];
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
        void this.prepare(command.id, true)
          .then((prepared) =>
            this.launch(prepared, !prepared.notice && readyToRun(prepared.command, prepared.input)),
          )
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
    const options = this.options();
    if (!options) throw notConnected();
    validateCommand(command);
    if (command.shortcut) command.shortcut = parseAccelerator(command.shortcut, true);
    if (command.enabled) this.checkShortcut(command);
    const old = this.store.data.commands.find((item) => item.id === command.id);
    const registered = old?.enabled && old.shortcut && !this.errors[old.id] ? old.shortcut : '';
    const next = command.enabled ? command.shortcut : '';
    const same = Boolean(
      registered && next && effectiveAccelerator(registered) === effectiveAccelerator(next),
    );
    if (next && !same) this.register(command);
    let saved: CommandDefinition;
    try {
      saved = await saveRemote(options, command, expectedRevision);
      await this.store.change((data) => {
        const index = data.commands.findIndex((item) => item.id === command.id);
        if (index < 0) data.commands.push(saved);
        else data.commands[index] = saved;
      });
    } catch (error) {
      if (next && !same) globalShortcut.unregister(next);
      throw error;
    }
    if (registered && !same) globalShortcut.unregister(registered);
    delete this.errors[command.id];
    this.changed();
    return saved;
  }

  async delete(id: string, revision: number) {
    const options = this.options();
    if (!options) throw notConnected();
    const command = this.find(id);
    await deleteRemote(options, id, revision);
    await this.store.change((data) => {
      data.commands = data.commands.filter((item) => item.id !== id);
    });
    if (command.enabled && command.shortcut && !this.errors[id])
      globalShortcut.unregister(command.shortcut);
    delete this.errors[id];
    this.changed();
  }
}
