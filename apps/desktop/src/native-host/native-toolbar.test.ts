import { describe, expect, it, vi } from 'vitest';
import type { SelectionToolbarSettings } from '@atd/agent-contracts';
import { fixtureCommands } from '../../tests/command-fixtures';
import type { NativeBridge } from '../native-bridge/client';
import { nativeToolbar, screenshotToolbarParams, toolbarParams } from './native-toolbar';

const settings: SelectionToolbarSettings = {
  enabled: true,
  excludedApps: [{ bundleId: 'com.apple.Terminal', name: 'Terminal' }],
  activation: 'hold',
  activationKeys: ['option'],
  showHud: true,
  smallIcon: 'click',
  position: 'above',
};

/** A shell that answers every toolbar push and records what it took. */
function fakeShell() {
  const call = vi.fn(async (_method: string, _params: unknown) => ({}));
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
      screenshotToolbar: false,
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
      smallIcon: 'click',
      position: 'above',
      excludedBundleIds: ['com.apple.Terminal'],
      commands: [
        { id: 'translate', name: 'Translate selection' },
        { id: 'summarize', name: 'Summarize files' },
      ],
    });
  });

  it('offers on the screenshot toolbar the enabled commands placed there that take a screenshot', () => {
    const commands = fixtureCommands().map((command) => ({ ...command, enabled: true }));
    // Placed by default only once its input is a screenshot, as a command that never chose is.
    expect(screenshotToolbarParams(commands)).toEqual({ commands: [] });
    const [translate, extract, polish, summarize] = commands;
    if (!translate || !extract || !polish || !summarize) throw new Error('A fixture is missing.');
    const shot = { ...summarize.input, source: 'screenshot' as const };
    summarize.input = shot;
    summarize.placement = { ...summarize.placement, screenshotToolbar: true };
    polish.input = shot;
    polish.placement = { ...polish.placement, screenshotToolbar: true };
    // Translate is placed there but reads the selection, so the toolbar cannot run it.
    translate.placement = { ...translate.placement, screenshotToolbar: true };
    extract.input = shot;
    expect(screenshotToolbarParams(commands)).toEqual({
      commands: [
        { id: 'polish', name: 'Polish writing' },
        { id: 'summarize', name: 'Summarize files' },
      ],
    });
    polish.enabled = false;
    expect(screenshotToolbarParams(commands).commands).toEqual([
      { id: 'summarize', name: 'Summarize files' },
    ]);
  });

  it('waits for the service settings, then pushes only a changed set', async () => {
    const { bridge, call } = fakeShell();
    let current: SelectionToolbarSettings | null = null;
    const commands = fixtureCommands().map((command) => ({ ...command, enabled: true }));
    const toolbar = nativeToolbar(bridge, { settings: () => current, commands: () => commands });
    const calls = (method: string) => call.mock.calls.filter(([name]) => name === method);
    toolbar.sync();
    // Let the queued push run: before the settings loaded only the screenshot toolbar, which
    // follows the commands alone, has something to send.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls('toolbar.set')).toHaveLength(0);
    expect(call).toHaveBeenCalledExactlyOnceWith('screenshotToolbar.set', { commands: [] });
    current = settings;
    toolbar.sync();
    toolbar.sync();
    await vi.waitFor(() => expect(calls('toolbar.set')).toHaveLength(1));
    current = { ...settings, enabled: false };
    toolbar.sync();
    await vi.waitFor(() => expect(calls('toolbar.set')).toHaveLength(2));
    expect(call).toHaveBeenLastCalledWith(
      'toolbar.set',
      expect.objectContaining({ enabled: false, excludedBundleIds: ['com.apple.Terminal'] }),
    );
    expect(calls('screenshotToolbar.set')).toHaveLength(1);
  });
});
