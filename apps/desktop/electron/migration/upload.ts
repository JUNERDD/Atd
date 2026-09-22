import { uploadCredential, type UploadVerdict } from './channel';
import { decryptConnectionsOnce } from './decrypt';
import { HANDOFF_MARKER, writeMarker } from './markers';
import { pauseAndFlush } from './pause';

/**
 * Desktop migration upload flow (explicit user action only):
 * 1. Record pause+flush markers (pure client has no local runs to stop).
 * 2. Decrypt each connected connection once with safeStorage.
 * 3. Upload decryptable credentials over the authenticated service channel.
 * 4. Record the handoff marker with per-connection verdicts.
 *
 * Undecryptable connections keep a truthful re-prompt verdict; the old
 * ciphertext stays in desktop settings for rollback.
 */
export interface MigrationUploadResult {
  serviceId: string | null;
  pausedAt: string;
  flushedAt: string;
  verdicts: UploadVerdict[];
  reprompt: { connectionId: string; providerId: string; detail: string }[];
}

export async function runMigrationUpload(serviceDataDir: string): Promise<MigrationUploadResult> {
  const { pausedAt, flushedAt } = await pauseAndFlush();
  const { ready, blocked } = await decryptConnectionsOnce();
  const verdicts: UploadVerdict[] = [];
  for (const item of ready) {
    try {
      verdicts.push(await uploadCredential(serviceDataDir, item));
    } catch (error) {
      verdicts.push({
        connectionId: item.connectionId,
        uploaded: false,
        readable: false,
        modelCheck: 'unchecked',
        detail: error instanceof Error ? error.message.slice(0, 500) : 'Upload failed.',
      });
    }
  }
  const reprompt = blocked.map((item) => ({
    connectionId: item.connectionId,
    providerId: item.providerId,
    detail: item.detail,
  }));
  const uploaded = verdicts.filter((verdict) => verdict.uploaded).length;
  await writeMarker(HANDOFF_MARKER, {
    serviceId: null,
    note: `Uploaded ${uploaded}/${ready.length} credentials; ${reprompt.length} need reconnect.`,
  });
  return { serviceId: null, pausedAt, flushedAt, verdicts, reprompt };
}
