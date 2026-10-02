import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { errorMessage } from '@atd/agent-contracts';
import type { Logger } from './logging.js';

/** Ordered per-run JSONL audit; flushed before a run reaches its terminal state. */
export class AuditWriter {
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly log: Logger,
  ) {}

  append(entry: Record<string, unknown>): void {
    this.chain = this.chain
      .then(async () => {
        await mkdir(path.dirname(this.file), { recursive: true });
        await appendFile(
          this.file,
          `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`,
        );
      })
      .catch((error: unknown) => {
        this.log.warn('Audit write failed.', { error: errorMessage(error) });
      });
  }

  flush(): Promise<void> {
    return this.chain.then(
      () => undefined,
      () => undefined,
    );
  }
}
