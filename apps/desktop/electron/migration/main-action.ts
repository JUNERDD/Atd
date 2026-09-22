import { dialog } from 'electron';
import { defaultServiceDataDir } from './channel';
import { runMigrationUpload } from './upload';

/**
 * Explicit T2 migration menu action: asks for the service dataDir, then
 * records pause+flush markers and uploads decrypted credentials to the
 * running service. T6 pure client has no local executions to stop.
 */
export async function runServiceMigration(): Promise<void> {
  const picked = await dialog.showOpenDialog({
    title: 'Choose the agent service data directory',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: defaultServiceDataDir(),
  });
  if (picked.canceled || !picked.filePaths[0]) return;
  const result = await runMigrationUpload(picked.filePaths[0]);
  const lines = [
    ...result.verdicts.map(
      (verdict) =>
        `${verdict.connectionId}: ${verdict.uploaded ? `uploaded (${verdict.modelCheck})` : verdict.detail}`,
    ),
    ...result.reprompt.map((item) => `${item.connectionId}: ${item.detail}`),
  ];
  await dialog.showMessageBox({
    type: 'info',
    title: 'Migration upload finished',
    message:
      lines.length > 0
        ? lines.join('\n')
        : 'No provider connections found. Data migration continues in the service.',
  });
}
