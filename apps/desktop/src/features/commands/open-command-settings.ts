import { showErrorToast } from '../../components/toast-store';

/** Storage key the web preview uses to reach an already-open settings tab. */
export const COMMAND_SETTINGS_STORAGE_KEY = 'ai.settings.editCommand';

export function isCommandId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

function settingsUrl(commandId: string): URL {
  const url = new URL(location.href);
  url.hash = `settings?commandId=${encodeURIComponent(commandId)}`;
  return url;
}

/**
 * Opens the settings window at the editor for one command. In the desktop app the main process
 * forwards the id to the settings window; the web preview shares the origin, so it reaches an
 * already-open settings tab through storage and a fresh tab through the URL.
 */
export async function openCommandSettings(commandId: string): Promise<void> {
  if (!isCommandId(commandId)) throw new Error('Unknown command.');
  try {
    const settings = window.desktop?.settings;
    if (settings?.openCommand) {
      await settings.openCommand(commandId);
      return;
    }
    if (settings) {
      await settings.open();
      return;
    }
    try {
      localStorage.setItem(
        COMMAND_SETTINGS_STORAGE_KEY,
        JSON.stringify({ commandId, nonce: Date.now() }),
      );
    } catch {
      // Private browsing can refuse storage; the URL still carries the target.
    }
    const opened = window.open(settingsUrl(commandId), 'ai-settings', 'width=1000,height=720');
    opened?.focus();
  } catch (error) {
    showErrorToast(error);
  }
}
