/** The manifest command that opens the in-page ask. */
export const ASK_COMMAND = 'ask-on-page';

/** The ask command's shortcut as Chrome shows it (the person may change it), '' when unset. */
export async function askShortcut(): Promise<string> {
  const commands = await chrome.commands.getAll();
  return commands.find((command) => command.name === ASK_COMMAND)?.shortcut ?? '';
}
