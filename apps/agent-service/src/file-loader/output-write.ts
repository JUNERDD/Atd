import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** A storage failure, distinct from malformed content or a parser exceeding its worker budget. */
export class OutputWriteError extends Error {
  constructor(cause: unknown) {
    super('the extracted files could not be saved', { cause });
    this.name = 'OutputWriteError';
  }
}

/** Write only generated output paths; conversion happens before this storage-only boundary. */
export function writeExtractedFile(file: string, content: string | Uint8Array): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content, { flag: 'wx' });
  } catch (error) {
    throw new OutputWriteError(error);
  }
}
