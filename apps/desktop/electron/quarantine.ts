import { execFile } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Absolute, so a changed PATH cannot substitute another program. */
const XATTR = '/usr/bin/xattr';
export const QUARANTINE_ATTRIBUTE = 'com.apple.quarantine';
/**
 * Flags as browsers set them for a download: 0x0001 (downloaded) and 0x0080; 0x0040 (user
 * approved) stays clear, so Gatekeeper still assesses the file when it is first opened.
 */
const QUARANTINE_FLAGS = '0081';

/**
 * The `com.apple.quarantine` value: `flags;hex Unix seconds;agent;event UUID`. The UUID links an
 * entry in the QuarantineEvents database; no entry is written here, so it stays empty.
 */
export function quarantineValue(agent: string, now: Date): string {
  const seconds = Math.floor(now.getTime() / 1000)
    .toString(16)
    .padStart(8, '0');
  // A field separator or line break in the app name would shift the fields that follow it.
  return `${QUARANTINE_FLAGS};${seconds};${agent.replace(/[;\r\n]/g, ' ')};`;
}

/** `xattr` arguments that write the quarantine value; passed as an array, never through a shell. */
export function quarantineArgs(filePath: string, agent: string, now: Date): string[] {
  return ['-w', QUARANTINE_ATTRIBUTE, quarantineValue(agent, now), filePath];
}

/**
 * Writes bytes that came from a download and marks them quarantined on macOS, so Gatekeeper
 * treats the file as downloaded when it is opened. A file that cannot be marked is removed and the
 * write fails, rather than leaving unmarked downloaded bytes behind. Other platforms only write.
 */
export async function writeDownloadedFile(
  filePath: string,
  bytes: Uint8Array,
  agent: string,
): Promise<void> {
  await writeFile(filePath, bytes);
  if (process.platform !== 'darwin') return;
  try {
    await run(XATTR, quarantineArgs(filePath, agent, new Date()), { timeout: 5000 });
  } catch (error) {
    await rm(filePath, { force: true });
    throw new Error('The downloaded file could not be marked as downloaded from the internet.', {
      cause: error,
    });
  }
}
