import { isDeepStrictEqual } from 'node:util';
import { clipboard, globalShortcut, systemPreferences } from 'electron';
import type { AgentClientOptions } from '@ai/agent-client';
import SelectionHook from 'selection-hook';
import {
  commandHoldingShortcut,
  commandShortcutHolder,
  effectiveAccelerator,
  parseAccelerator,
} from '@ai/agent-contracts';
import type { ShortcutBindings } from '../../src/client/settings-contract';
import type { CommandDefinition } from '../../src/client/agent/command-schema';
import type { PreparedCommand } from '../../src/client/agent/bridge';
import { prepareCommand } from '../../src/client/agent/command-prepare';
import { readyToRun, validateCommand } from '../../src/client/agent/command-validation';
import { deleteRemote, fetchCommands, saveRemote } from '../../src/client/agent/command-remote';
import { notConnected } from '../../src/client/agent/service-manage';
import { AgentStore } from './store';
import { errorMessage } from '../../src/client/agent/validation';

/**
 * Plugin commands are read-only apart from `enabled`, the rule the service also enforces; a new
 * command never claims a plugin, and a saved one keeps the plugin the service reported.
 */
function assertPluginSave(
  command: CommandDefinition,
  old: CommandDefinition | undefined,
  expectedRevision: number,
) {
  if (expectedRevision === 0) {
    if (command.pluginId) throw new Error('A new command cannot belong to a plugin.');
    return;
  }
  if (command.pluginId !== old?.pluginId)
    throw new Error('A command keeps the plugin it came from.');
  if (!old?.pluginId) return;
  // JSON drops keys holding `undefined`, so an absent optional field matches an unset one.
  const fields = (value: CommandDefinition): unknown =>
    JSON.parse(JSON.stringify({ ...value, enabled: false, revision: 0 }));
  if (!isDeepStrictEqual(fields(command), fields(old)))
    throw new Error('Commands provided by a plugin are read-only. Duplicate one to customize it.');
}

export class CommandService {
  readonly errors: Record<string, string> = {};
  /**
   * Plugin commands from the last service refresh. The service owns them, so they live only in
   * memory: the saved cache holds the user's own commands, which the desktop migration imports.
   */
  private plugins: CommandDefinition[] = [];
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

  list(): CommandDefinition[] {
    return [...this.store.data.commands, ...this.plugins];
  }

  find(id: string) {
    const command = this.list().find((command) => command.id === id);
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

  /**
   * Reads the selected text while the other app still has focus, for any enabled command that
   * fills its input from the selection (the one a shortcut launches, or one picked in the panel).
   * Without such a command nothing reads it, so the native hook and the Accessibility check stay off.
   */
  captureSelection() {
    this.captured = null;
    if (!this.list().some((command) => command.enabled && command.input.selection)) return;
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

  /** `prepareCommand`, asking for macOS Accessibility access when the command reads the selection. */
  async prepare(id: string, expectCapture = false): Promise<PreparedCommand> {
    const command = this.find(id);
    if (command.enabled && command.input.selection) this.requestAccessibility();
    return prepareCommand(command, (source) => this.capture(source), expectCapture);
  }

  initialize() {
    for (const command of this.list()) {
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
      data.commands = commands.filter((command) => !command.pluginId);
    });
    this.plugins = commands.filter((command) => command.pluginId);
    this.initialize();
    this.changed();
  }

  private unregisterAll() {
    for (const command of this.list()) {
      if (command.enabled && command.shortcut && !this.errors[command.id])
        globalShortcut.unregister(command.shortcut);
    }
    for (const id of Object.keys(this.errors)) delete this.errors[id];
  }

  private checkShortcut(command: CommandDefinition) {
    if (!command.shortcut) return;
    const shortcut = parseAccelerator(command.shortcut, true, process.platform);
    if (
      commandShortcutHolder(
        { id: command.id, shortcut },
        this.shortcuts(),
        this.list(),
        process.platform,
      )
    )
      throw new Error('This shortcut is already assigned to another action.');
  }

  assertSettings(shortcuts: ShortcutBindings) {
    for (const value of Object.values(shortcuts))
      if (commandHoldingShortcut(value, this.list(), process.platform))
        throw new Error('This shortcut is assigned to a command.');
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
    const old = this.list().find((item) => item.id === command.id);
    assertPluginSave(command, old, expectedRevision);
    // A plugin command's content is the service's; saving it only changes `enabled`.
    if (!old?.pluginId) validateCommand(command);
    if (command.shortcut)
      command.shortcut = parseAccelerator(command.shortcut, true, process.platform);
    if (command.enabled) this.checkShortcut(command);
    const registered = old?.enabled && old.shortcut && !this.errors[old.id] ? old.shortcut : '';
    const next = command.enabled ? command.shortcut : '';
    const same = Boolean(
      registered &&
      next &&
      effectiveAccelerator(registered, process.platform) ===
        effectiveAccelerator(next, process.platform),
    );
    if (next && !same) this.register(command);
    let saved: CommandDefinition;
    try {
      saved = await saveRemote(options, command, expectedRevision);
      if (old?.pluginId)
        this.plugins = this.plugins.map((item) => (item.id === saved.id ? saved : item));
      else
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
    if (command.pluginId)
      throw new Error(
        'Commands provided by a plugin cannot be deleted. Turn the command off instead.',
      );
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
