import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { AddonArtifact } from '@atd/agent-contracts';
import { downloadArchive } from './download.js';
import { installDir, stagingRoot, type AddonRecord } from './store.js';
import { unpackArchive } from './unpack.js';

/** The phases of an install, in order; the registry shows them in the add-on's view. */
export type InstallPhase = 'downloading' | 'verifying' | 'installing';

/** One install of the archive the lock pins for an add-on. */
export interface InstallJob {
  dataDir: string;
  artifact: AddonArtifact;
  development: boolean;
  /** Cancels the job until it commits (`activate`); after that the new install stays. */
  signal: AbortSignal;
  phase: (phase: InstallPhase) => void;
  progress: (received: number) => void;
  /**
   * Makes the unpacked archive the add-on's active install (`state.json`): the commit point. It
   * runs only for a fully verified archive already in its install directory.
   */
  activate: (record: AddonRecord) => Promise<void>;
}

/**
 * Downloads the pinned archive into a staging directory of its own, verifies and unpacks it
 * there (unpack.ts), moves the tree into its install directory with one rename and activates it.
 * Nothing outside staging changes before the rename, and the previous install stays active until
 * `activate` replaces it, so a cancel or failure at any step leaves the add-on as it was. The
 * staging directory is removed however the job ends.
 */
export async function runInstall(job: InstallJob): Promise<void> {
  const { artifact, signal } = job;
  const staging = path.join(stagingRoot(job.dataDir), `${artifact.id}-${randomUUID()}`);
  await mkdir(staging, { recursive: true });
  try {
    job.phase('downloading');
    const archive = path.join(staging, 'archive.tar.gz');
    await downloadArchive(artifact, {
      file: archive,
      signal,
      development: job.development,
      onProgress: job.progress,
    });
    job.phase('verifying');
    const tree = path.join(staging, 'tree');
    await unpackArchive(archive, tree, artifact, signal);
    job.phase('installing');
    signal.throwIfAborted();
    const target = installDir(job.dataDir, artifact.id, artifact.sha256);
    // A directory of this archive can only be left over from an install that never activated.
    await rm(target, { recursive: true, force: true });
    await mkdir(path.dirname(target), { recursive: true });
    await rename(tree, target);
    try {
      signal.throwIfAborted();
      await job.activate({ sha256: artifact.sha256, version: artifact.version });
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      throw error;
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
