import { describe, expect, it, vi } from 'vitest';
import type { SelectionToolbarSettings } from '@atd/agent-contracts';
import { fixtureCommands } from '../../tests/command-fixtures';
import type { NativeBridge } from '../native-bridge/client';
import { nativeToolbar, toolbarParams } from './native-toolbar';

const settings: SelectionToolbarSettings = {
  enabled: true,
  excludedApps: [{ bundleId: 'com.apple.Terminal', name: 'Terminal' }],
  activation: 'hold',
  activationKeys: ['option'],
  showHud: true,
};

/** A shell that answers every `toolbar.set` and records what it took. */
function fakeShell() {
  const call = vi.fn(async () => ({}));
  return { bridge: { call } as unknown as NativeBridge, call };
}

describe('selection toolbar push', () => {
  it('offers the enabled commands placed on it that read the selection, in list order', () => {
    const commands = fixtureCommands().map((command) => ({ ...command, enabled: true }));
    const fixture = (id: string) => {
      const command = commands.find((item) => item.id === id);
      if (!command) throw new Error(`The ${id} template is missing.`);
      return command;
    };
    fixture('extract').enabled = false;
    // Polish takes the selection, but only conversations offer it.
    fixture('polish').placement = {
      selectionToolbar: false,
      turnSelection: true,
      turnActions: true,
    };
    // Summarize reads its input by hand: placed on the toolbar, it shows there only once it reads
    // the selection through the variable.
    const summarize = fixture('summarize');
    summarize.placement = { ...summarize.placement, selectionToolbar: true };
    expect(toolbarParams(settings, commands).commands).toEqual([
      { id: 'translate', name: 'Translate selection' },
    ]);
    summarize.input = { ...summarize.input, selection: true };
    expect(toolbarParams(settings, commands)).toEqual({
      enabled: true,
      activation: 'hold',
      activationKeys: ['option'],
      showHud: true,
      excludedBundleIds: ['com.apple.Terminal'],
      commands: [
        { id: 'translate', name: 'Translate selection' },
        { id: 'summarize', name: 'Summarize files' },
      ],
    });
  });

  it('waits for the service settings, then pushes only a changed set', async () => {
    const { bridge, call } = fakeShell();
    let current: SelectionToolbarSettings | null = null;
    const commands = fixtureCommands().map((command) => ({ ...command, enabled: true }));
    const toolbar = nativeToolbar(bridge, { settings: () => current, commands: () => commands });
    toolbar.sync();
    // Let the queued push run: before the settings loaded it has nothing to send.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(call).not.toHaveBeenCalled();
    current = settings;
    toolbar.sync();
    toolbar.sync();
    await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
    current = { ...settings, enabled: false };
    toolbar.sync();
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    expect(call).toHaveBeenLastCalledWith(
      'toolbar.set',
      expect.objectContaining({ enabled: false, excludedBundleIds: ['com.apple.Terminal'] }),
    );
  });
});
