import { mkdir, open, rename, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

/** Previous launches kept beside the current log: service.1.log (newest) … service.4.log. */
const KEPT_PREVIOUS = 4;
/** How much of the log a startup failure message is built from. */
const TAIL_BYTES = 16 * 1024;

/** `<dataDir>/logs`, which holds the service's own output across launches. */
export function serviceLogDir(dataDir: string): string {
  return path.join(path.resolve(dataDir), 'logs');
}

/** An open `service.log` for one spawn; `start` is its size before this spawn wrote to it. */
export interface ServiceLog {
  handle: FileHandle;
  file: string;
  start: number;
}

/**
 * Rotates the previous launches' logs, then opens `service.log` for append. The child writes
 * stdout and stderr straight to this file instead of a pipe, so a service that outlives Electron
 * never writes into a dead pipe (EPIPE), and its output survives in packaged builds. Rotation is
 * best effort: a rename can fail while an orphaned service still holds the file open (Windows),
 * and this launch then appends to it; `start` still marks where this spawn's output begins.
 */
export async function openServiceLog(dataDir: string): Promise<ServiceLog> {
  const dir = serviceLogDir(dataDir);
  await mkdir(dir, { recursive: true });
  for (let index = KEPT_PREVIOUS; index >= 1; index -= 1) {
    const from = index === 1 ? 'service.log' : `service.${index - 1}.log`;
    try {
      await rename(path.join(dir, from), path.join(dir, `service.${index}.log`));
    } catch {
      // Missing (fewer launches so far) or locked: keep going with the files that did move.
    }
  }
  const file = path.join(dir, 'service.log');
  const handle = await open(file, 'a');
  try {
    return { handle, file, start: (await handle.stat()).size };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/**
 * User-facing reason a service exited before publishing its endpoint, read from the output this
 * spawn wrote: the first `SyntaxError:`/`Error:` line, else the last few lines, else the exit
 * status.
 */
export async function startupFailureMessage(
  log: Pick<ServiceLog, 'file' | 'start'>,
  exit: { code: number | null; signal: NodeJS.Signals | null },
): Promise<string> {
  const lines = (await readSince(log))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const syntax = lines.find((line) => line.startsWith('SyntaxError:') || line.startsWith('Error:'));
  if (syntax) return syntax.slice(0, 500);
  const status = exit.signal
    ? `was stopped by ${exit.signal}`
    : `exited with code ${exit.code ?? 1}`;
  // stdout shares the file, so the service's JSON log lines precede the CLI's plain-text
  // failure reason; prefer the plain lines when there are any.
  const plain = lines.filter((line) => !line.startsWith('{'));
  const tail = (plain.length > 0 ? plain : lines).slice(-4).join(' ');
  return (tail || `The agent service ${status}.`).slice(0, 500);
}

/** The last TAIL_BYTES this spawn wrote; empty when the log cannot be read. */
async function readSince(log: Pick<ServiceLog, 'file' | 'start'>): Promise<string> {
  let handle: FileHandle;
  try {
    handle = await open(log.file, 'r');
  } catch {
    return '';
  }
  try {
    const size = (await handle.stat()).size;
    const from = Math.max(log.start, size - TAIL_BYTES);
    if (from >= size) return '';
    const buffer = Buffer.alloc(size - from);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return '';
  } finally {
    await handle.close();
  }
}
