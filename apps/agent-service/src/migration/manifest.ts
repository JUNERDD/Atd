import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  parse,
  MigrationManifestSchema,
  type MigrationCredentialRecord,
  type MigrationDomain,
  type MigrationDomainRecord,
  type MigrationManifest,
} from '@ai/agent-contracts';
import { atomicWrite } from '../config.js';

export type { MigrationDomain } from '@ai/agent-contracts';

/**
 * Versioned migration manifest (freeze candidate `migration-manifest v1`).
 * Paths: `<dataDir>/migration.json` plus the `<dataDir>/migration.complete`
 * marker written only after every required domain verifies. The manifest
 * makes retries idempotent: completed domains compare checksums instead of
 * re-importing, and a second full run is a verified no-op.
 */
export const REQUIRED_DOMAINS: readonly MigrationDomain[] = [
  'tasks',
  'commands',
  'policy',
  'resources',
  'sessions',
  'providers',
  'memory',
];

export function manifestFile(dataDir: string): string {
  return path.join(dataDir, 'migration.json');
}

export function completionMarker(dataDir: string): string {
  return path.join(dataDir, 'migration.complete');
}

function emptyRecord(): MigrationDomainRecord {
  return { status: 'pending', count: 0, checksum: '', error: '', attemptedAt: '' };
}

export function emptyManifest(serviceId: string, sourceRoot: string): MigrationManifest {
  const domains: Record<string, MigrationDomainRecord> = {};
  for (const domain of REQUIRED_DOMAINS) domains[domain] = emptyRecord();
  const now = new Date().toISOString();
  return {
    version: 1,
    serviceId,
    sourceRoot,
    sourceVersion: 'desktop-v1',
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    pausedAt: null,
    flushedAt: null,
    domains,
    credentials: [],
    notes: [],
  };
}

export class ManifestStore {
  private chain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly file: string,
    public data: MigrationManifest,
  ) {}

  static async load(
    dataDir: string,
    serviceId: string,
    sourceRoot: string,
  ): Promise<ManifestStore> {
    const file = manifestFile(dataDir);
    try {
      if ((await stat(file)).size > 4 * 1024 * 1024)
        throw new Error('Migration manifest is too large.');
      const data = parse(MigrationManifestSchema, JSON.parse(await readFile(file, 'utf8')));
      if (data.serviceId !== serviceId)
        throw new Error('Migration manifest belongs to another service identity.');
      for (const domain of REQUIRED_DOMAINS) data.domains[domain] ??= emptyRecord();
      return new ManifestStore(file, data);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        const store = new ManifestStore(file, emptyManifest(serviceId, sourceRoot));
        await atomicWrite(file, store.data);
        return store;
      }
      throw error;
    }
  }

  static async read(dataDir: string): Promise<MigrationManifest | null> {
    try {
      return parse(
        MigrationManifestSchema,
        JSON.parse(await readFile(manifestFile(dataDir), 'utf8')),
      );
    } catch {
      return null;
    }
  }

  change<T>(update: (draft: MigrationManifest) => T | Promise<T>): Promise<T> {
    const operation = this.chain.then(async () => {
      const draft = structuredClone(this.data);
      const result = await update(draft);
      draft.updatedAt = new Date().toISOString();
      await atomicWrite(this.file, parse(MigrationManifestSchema, draft));
      this.data = draft;
      return result;
    });
    this.chain = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async recordDomain(domain: MigrationDomain, record: MigrationDomainRecord): Promise<void> {
    await this.change((data) => {
      data.domains[domain] = record;
    });
  }

  async recordCredential(record: MigrationCredentialRecord): Promise<void> {
    await this.change((data) => {
      const index = data.credentials.findIndex((item) => item.connectionId === record.connectionId);
      if (index >= 0) data.credentials[index] = record;
      else data.credentials.push(record);
    });
  }

  async note(text: string): Promise<void> {
    await this.change((data) => {
      if (data.notes.length < 50) data.notes.push(text.slice(0, 2000));
    });
  }
}

/** True when every required domain imported or verified at least once. */
export function allDomainsDone(manifest: MigrationManifest): boolean {
  return REQUIRED_DOMAINS.every((domain) => {
    const status = manifest.domains[domain]?.status;
    return status === 'imported' || status === 'verified' || status === 'skipped';
  });
}
