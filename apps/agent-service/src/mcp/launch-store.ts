import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import {
  McpLaunchApprovalRecordSchema,
  parse,
  type McpLaunchApprovalRecord,
} from '@atd/agent-contracts';
import { atomicWrite } from '../config.js';
import type { Logger } from '../logging.js';

/**
 * The launch approval store, `<dataDir>/security/launch-approvals.json`. Only the service writes
 * it, and only to record an approval granted through a shell-only route or the CLI, to withdraw
 * one, or to settle the one-time notice; the agent's file tools refuse the whole `security`
 * directory (service-fs.ts). A record alone approves nothing: its fingerprint must match one
 * computed with the key in the keyring (mcp/launch-key.ts).
 */

const StoreFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    approvals: Type.Array(McpLaunchApprovalRecordSchema, { maxItems: 2000 }),
    /** The one-time re-approval notice is still due (McpStatusResponse `approvalNotice`). */
    notice: Type.Boolean(),
  },
  { additionalProperties: false },
);
type StoreFile = Static<typeof StoreFileSchema>;

/** Directory of the service's own security state; see `protectedWriteRoots`. */
export function securityDir(dataDir: string): string {
  return path.join(dataDir, 'security');
}

export function launchStoreFile(dataDir: string): string {
  return path.join(securityDir(dataDir), 'launch-approvals.json');
}

export class LaunchStore {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly dataDir: string,
    private file: StoreFile,
  ) {}

  /**
   * Reads the store. A missing file is a profile from before launch approvals: `migrate` decides
   * the notice and the file is written at once, so this happens once. An unreadable file fails
   * closed: no approvals, the notice due, and the file left as it is until the next write.
   */
  static async load(
    dataDir: string,
    log: Logger,
    migrate: () => Promise<boolean>,
  ): Promise<LaunchStore> {
    let raw: string;
    try {
      raw = await readFile(launchStoreFile(dataDir), 'utf8');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      const store = new LaunchStore(dataDir, {
        version: 1,
        approvals: [],
        notice: await migrate(),
      });
      await store.save();
      return store;
    }
    try {
      return new LaunchStore(dataDir, parse(StoreFileSchema, JSON.parse(raw)));
    } catch {
      log.warn('Launch approvals could not be read; every launch needs approval again.');
      return new LaunchStore(dataDir, { version: 1, approvals: [], notice: true });
    }
  }

  get(serverId: string): McpLaunchApprovalRecord | undefined {
    return this.file.approvals.find((record) => record.serverId === serverId);
  }

  notice(): boolean {
    return this.file.notice;
  }

  /** Stores an approval, replacing the server's previous one. */
  put(record: McpLaunchApprovalRecord): Promise<void> {
    return this.write((file) => ({
      ...file,
      approvals: [...file.approvals.filter((entry) => entry.serverId !== record.serverId), record],
    }));
  }

  /** Drops a server's approval; answers whether it had one. */
  async remove(serverId: string): Promise<boolean> {
    if (!this.get(serverId)) return false;
    await this.write((file) => ({
      ...file,
      approvals: file.approvals.filter((entry) => entry.serverId !== serverId),
    }));
    return true;
  }

  dismissNotice(): Promise<void> {
    return this.write((file) => ({ ...file, notice: false }));
  }

  /** Writes one change after the ones before it; memory follows the file only once it is saved. */
  private write(change: (file: StoreFile) => StoreFile): Promise<void> {
    const next = this.queue.then(async () => {
      const updated = change(this.file);
      await atomicWrite(launchStoreFile(this.dataDir), updated);
      this.file = updated;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private save(): Promise<void> {
    return this.write((file) => file);
  }
}
