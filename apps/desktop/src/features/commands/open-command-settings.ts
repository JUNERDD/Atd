import { showErrorToast } from '../../components/toast-store';

export function isCommandId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

/**
 * Opens the settings window at the editor for one command. The shell forwards the id to an open
 * settings window, or opens a new one with the command selected.
 */
export async function openCommandSettings(commandId: string): Promise<void> {
  if (!isCommandId(commandId)) throw new Error('Unknown command.');
  try {
    await window.desktop?.settings.openCommand(commandId);
  } catch (error) {
    showErrorToast(error);
  }
}
