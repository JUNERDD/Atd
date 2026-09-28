import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { acquireLock, releaseLock } from '../config.js';
import { serviceConfigurationId, ConnectionStore } from '../credentials/connections.js';
import { Ledger } from '../ledger.js';
import type { Logger } from '../logging.js';
import { servicePaths } from '../storage.js';
import { checkSqliteSet, sha256 } from './checks.js';
import { importCommands, importTasks } from './import-tasks.js';
import { importPolicy } from './import-policy.js';
import { importMemory } from './import-memory.js';
import { importProvidersMetadata } from './import-providers.js';
import { importOutputs, importResources, importSessions } from './import-resources.js';
import {
  allDomainsDone,
  completionMarker,
  ManifestStore,
  type MigrationDomain,
} from './manifest.js';
import {
  loadResourcesIndex,
  loadSourceDocs,
  readPauseMarkers,
  readServiceId,
  type SourceDocs,
  type SourceLayout,
} from './sources.js';

/**
 * Migration orchestrator. Offline import runs with the service stopped and
 * the dataDir lock held by this process, so no dual writes are possible.
 * Every domain is idempotent: a second run re-verifies checksums and reports
 * a no-op. Failures keep partial imports and record the failing domain; a
 * retry resumes. Dry-run validates and counts without writing anything.
 */
export interface MigrateOptions {
  dataDir: string;
  sourceRoot: string;
  dryRun: boolean;
  /** Isolated copy without desktop pause markers; stability checks still apply. */
  assumeQuiesced: boolean;
  log: Logger;
}

export interface DomainOutcome {
  domain: string;
  status: 'imported' | 'verified' | 'failed' | 'skipped';
  count: number;
  checksum: string;
  error: string;
}

export interface MigrateResult {
  dryRun: boolean;
  outcomes: DomainOutcome[];
  completed: boolean;
  manifestPath: string;
}

async function recordOutcome(manifest: ManifestStore, outcome: DomainOutcome): Promise<void> {
  await manifest.recordDomain(outcome.domain as MigrationDomain, {
    status: outcome.status,
    count: outcome.count,
    checksum: outcome.checksum,
    error: outcome.error,
    attemptedAt: new Date().toISOString(),
  });
}

export async function runMigration(options: MigrateOptions): Promise<MigrateResult> {
  const dataDir = path.resolve(options.dataDir);
  const sourceRoot = path.resolve(options.sourceRoot);
  if (dataDir === sourceRoot)
    throw new Error('The migration source must differ from the service dataDir.');
  const paths = servicePaths(dataDir);
  await acquireLock(paths);
  try {
    const serviceId = await readServiceId(dataDir);
    const { layout, docs } = await loadSourceDocs(sourceRoot);
    const markers = await readPauseMarkers(sourceRoot, options.assumeQuiesced);

    // Dry-run validates and counts without writing anything, including the manifest.
    if (options.dryRun) return dryRunReport(dataDir, layout, docs, markers);

    const manifest = await ManifestStore.load(dataDir, serviceId, sourceRoot);
    await manifest.change((data) => {
      data.pausedAt ??= markers.pausedAt;
      data.flushedAt ??= markers.flushedAt;
      if (options.assumeQuiesced && !markers.pausedAt && data.notes.length < 50)
        data.notes.push('Source assumed quiesced (--assume-quiesced on an isolated copy).');
    });

    const ledger = await Ledger.load(paths);
    const connections = await ConnectionStore.load(dataDir);
    const at = new Date().toISOString();
    const outcomes: DomainOutcome[] = [];
    const attempt = async (
      domain: DomainOutcome['domain'],
      work: () => Promise<{ count: number; checksum: string }>,
    ): Promise<void> => {
      try {
        const result = await work();
        const prior = manifest.data.domains[domain];
        const status =
          prior &&
          (prior.status === 'imported' || prior.status === 'verified') &&
          prior.checksum === result.checksum
            ? 'verified'
            : 'imported';
        const outcome: DomainOutcome = {
          domain,
          status,
          count: result.count,
          checksum: result.checksum,
          error: '',
        };
        outcomes.push(outcome);
        await recordOutcome(manifest, outcome);
      } catch (error) {
        const outcome: DomainOutcome = {
          domain,
          status: 'failed',
          count: 0,
          checksum: manifest.data.domains[domain]?.checksum ?? '',
          error: error instanceof Error ? error.message.slice(0, 2000) : 'Import failed.',
        };
        outcomes.push(outcome);
        await recordOutcome(manifest, outcome);
      }
    };

    await attempt('tasks', async () => {
      await importTasks(ledger, docs.workspace, layout, paths.sessionsDir);
      return {
        count: docs.workspace.tasks.length,
        checksum: sha256(JSON.stringify(docs.workspace.tasks)),
      };
    });
    await attempt('commands', async () => {
      await importCommands(dataDir, docs.workspace, at);
      return {
        count: docs.workspace.commands.length,
        checksum: sha256(JSON.stringify(docs.workspace.commands)),
      };
    });
    await attempt('policy', async () => {
      const memoryPaused = docs.workspace.memoryPaused ?? false;
      await importPolicy(
        dataDir,
        {
          defaultTier: docs.settings?.permissionTier ?? 'manual',
          memoryPaused,
        },
        at,
      );
      return {
        count: 1,
        checksum: sha256(`${docs.settings?.permissionTier ?? 'manual'}:${memoryPaused}`),
      };
    });
    await attempt('resources', async () => {
      const index = await loadResourcesIndex(layout);
      const result = await importResources(ledger, paths, index);
      const outputs = await importOutputs(layout, paths);
      return {
        count: index.resources.length + outputs.files,
        checksum: sha256(`${result.checksum}:${outputs.checksum}`),
      };
    });
    await attempt('sessions', async () => {
      const result = await importSessions(layout, paths);
      return { count: result.files, checksum: result.checksum };
    });
    await attempt('providers', async () => {
      if (!docs.settings) return { count: 0, checksum: sha256('no-settings') };
      await importProvidersMetadata(
        connections,
        docs.settings,
        (connection) =>
          serviceConfigurationId({
            provider: connection.provider,
            baseUrl: connection.baseUrl,
            authType: connection.authType,
            options: connection.options,
            customModels: connection.customModels,
          }),
        at,
      );
      return {
        count: docs.settings.connections.length,
        checksum: sha256(
          JSON.stringify(docs.settings.connections.map((item) => item.connectionId)),
        ),
      };
    });
    await attempt('memory', async () => {
      const flushed = Boolean(manifest.data.flushedAt) || options.assumeQuiesced;
      const result = await importMemory(layout, paths.agentDir, flushed);
      return { count: result.files, checksum: result.checksum };
    });

    const failed = outcomes.filter((outcome) => outcome.status === 'failed');
    let completed = false;
    if (failed.length === 0 && allDomainsDone(manifest.data)) {
      await manifest.change((data) => {
        data.completedAt = new Date().toISOString();
      });
      await writeFile(
        completionMarker(dataDir),
        JSON.stringify({ at: new Date().toISOString(), serviceId }),
        { mode: 0o600 },
      );
      completed = true;
    }
    return {
      dryRun: false,
      outcomes,
      completed,
      manifestPath: path.join(dataDir, 'migration.json'),
    };
  } finally {
    await releaseLock(paths);
  }
}

async function dryRunReport(
  dataDir: string,
  layout: SourceLayout,
  docs: SourceDocs,
  markers: { pausedAt: string | null; flushedAt: string | null },
): Promise<MigrateResult> {
  const index = await loadResourcesIndex(layout);
  const sqlite = await checkSqliteSet(layout.memoryDir);
  const outcomes: DomainOutcome[] = [
    {
      domain: 'tasks',
      status: 'verified',
      count: docs.workspace.tasks.length,
      checksum: sha256(JSON.stringify(docs.workspace.tasks)),
      error: '',
    },
    {
      domain: 'commands',
      status: 'verified',
      count: docs.workspace.commands.length,
      checksum: '',
      error: '',
    },
    { domain: 'policy', status: 'verified', count: 1, checksum: '', error: '' },
    {
      domain: 'resources',
      status: 'verified',
      count: index.resources.length,
      checksum: '',
      error: '',
    },
    { domain: 'sessions', status: 'verified', count: 0, checksum: '', error: '' },
    {
      domain: 'providers',
      status: docs.settings ? 'verified' : 'skipped',
      count: docs.settings?.connections.length ?? 0,
      checksum: '',
      error: docs.settings ? '' : 'No settings.json in source.',
    },
    {
      domain: 'memory',
      status: sqlite.consistent ? 'verified' : 'failed',
      count: 0,
      checksum: '',
      error: sqlite.consistent ? '' : sqlite.detail,
    },
  ];
  void markers;
  return {
    dryRun: true,
    outcomes,
    completed: false,
    manifestPath: path.join(dataDir, 'migration.json'),
  };
}
