import { describe, expect, it, vi } from 'vitest';
import type { SelectionToolbarSettings } from '@atd/agent-contracts';
import { initialCommands } from '../client/agent/command-templates';
import type { NativeBridge } from '../native-bridge/client';
import { nativeToolbar, toolbarParams } from './native-toolbar';

const settings: SelectionToolbarSettings = {
  enabled: true,
  excludedApps: [{ bundleId: 'com.apple.Terminal', name: 'Terminal' }],
};

/** A shell that answers every `toolbar.set` and records what it took. */
function fakeShell() {
  const call = vi.fn(async () => ({}));
  return { bridge: { call } as unknown as NativeBridge, call };
}

describe('selection toolbar push', () => {
  it('offers the enabled selection commands in list order, with the excluded bundle ids', () => {
    const commands = initialCommands().map((command) => ({ ...command, enabled: true }));
    const extract = commands.find((command) => command.id === 'extract');
    if (!extract) throw new Error('The extract template is missing.');
    extract.enabled = false;
    expect(toolbarParams(settings, commands)).toEqual({
      enabled: true,
      excludedBundleIds: ['com.apple.Terminal'],
      // Summarize reads its input by hand, so it is not a selection command.
      commands: [
        { id: 'translate', name: 'Translate selection' },
        { id: 'polish', name: 'Polish writing' },
      ],
    });
  });

  it('waits for the service settings, then pushes only a changed set', async () => {
    const { bridge, call } = fakeShell();
    let current: SelectionToolbarSettings | null = null;
    const commands = initialCommands().map((command) => ({ ...command, enabled: true }));
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
