import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  FolderRefSchema,
  Identifier,
  parse,
  type FolderRef,
  type FolderRegisterResponse,
} from '@atd/agent-contracts';
import { Type, type Static } from 'typebox';
import { atomicWrite } from '../config.js';
import { LedgerNotFound } from '../ledger.js';
import { checkFolder } from './check.js';

/**
 * One folder granted to a task. `introduced` turns true once a run started with the grant: that
 * run's material carried the folder's tree overview, later runs only list the folder.
 */
const GrantSchema = Type.Object(
  { folderId: Identifier, introduced: Type.Boolean() },
  { additionalProperties: false },
);
type Grant = Static<typeof GrantSchema>;

const FoldersFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    /** Every registered folder; an id is never reused for another realpath. */
    folders: Type.Array(FolderRefSchema),
    /** Grants by task id, in the order they were granted. */
    grants: Type.Record(Type.String(), Type.Array(GrantSchema)),
  },
  { additionalProperties: false },
);
type FoldersFile = Static<typeof FoldersFileSchema>;

/** A granted folder as a run starts with it. */
export interface RunFolderGrant {
  folder: FolderRef;
  /** The first run since the folder was granted (or granted again) introduces it. */
  introduce: boolean;
}

/**
 * The folder registry and the task grants (`folders.json` in the data dir). Only the shell
 * registers folders (`POST /v1/folders/register`), after a user gesture named them; a submit
 * grants registered folders to its task by id, so neither the page nor the agent can name a path.
 * Runs read the grants once at their start (`startRun`), so a revoke reaches later runs only.
 */
export class FolderStore {
  private chain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly file: string,
    private readonly dataDir: string,
    private state: FoldersFile,
  ) {}

  static async load(dataDir: string): Promise<FolderStore> {
    const file = path.join(dataDir, 'folders.json');
    let state: FoldersFile = { version: 1, folders: [], grants: {} };
    try {
      state = parse(FoldersFileSchema, JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    return new FolderStore(file, dataDir, state);
  }

  /**
   * Registers absolute directory paths, each answered in request order in exactly one list. The
   * same realpath keeps its folder id however it is reached.
   */
  register(paths: readonly string[]): Promise<FolderRegisterResponse> {
    if (paths.some((requested) => !path.isAbsolute(requested)))
      throw new TypeError('Invalid data: folder paths must be absolute.');
    return this.serialize(async () => {
      const response: FolderRegisterResponse = { registered: [], failures: [] };
      const added: FolderRef[] = [];
      for (const requested of paths) {
        const checked = await checkFolder(requested, this.dataDir);
        if (!checked.ok) {
          const { reason, message } = checked;
          response.failures.push({ path: requested, reason, message });
          continue;
        }
        let folder = [...this.state.folders, ...added].find((item) => item.path === checked.real);
        if (!folder) {
          const name = path.basename(checked.real).slice(0, 255);
          folder = { id: randomUUID(), name, path: checked.real };
          added.push(folder);
        }
        response.registered.push({ path: requested, folder: structuredClone(folder) });
      }
      if (added.length)
        await this.write({ ...this.state, folders: [...this.state.folders, ...added] });
      return response;
    });
  }

  /** The registered folders `ids` name; an unknown id is a bad request. */
  resolve(ids: readonly string[]): FolderRef[] {
    return ids.map((id) => {
      const folder = this.state.folders.find((item) => item.id === id);
      if (!folder) throw new TypeError(`Invalid data: folder ${id} was not registered.`);
      return structuredClone(folder);
    });
  }

  /**
   * Grants registered folders to a task, deduplicated by id. A folder granted again is introduced
   * again by the next run. Each folder must still be a directory a task may read.
   */
  async grant(taskId: string, ids: readonly string[]): Promise<void> {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    const folders = this.resolve(unique);
    return this.serialize(async () => {
      for (const folder of folders) {
        const checked = await checkFolder(folder.path, this.dataDir);
        if (!checked.ok || checked.real !== folder.path)
          throw new TypeError(`Invalid data: the folder "${folder.name}" is no longer available.`);
      }
      const kept = (this.state.grants[taskId] ?? []).filter(
        (grant) => !unique.includes(grant.folderId),
      );
      const added = unique.map((folderId): Grant => ({ folderId, introduced: false }));
      await this.writeGrants(taskId, [...kept, ...added]);
    });
  }

  /** The folders granted to a task, in grant order. */
  list(taskId: string): FolderRef[] {
    return this.resolve((this.state.grants[taskId] ?? []).map((grant) => grant.folderId));
  }

  /** Revokes one folder for the task's later runs; answers the folders that remain. */
  revoke(taskId: string, folderId: string): Promise<FolderRef[]> {
    return this.serialize(async () => {
      const grants = this.state.grants[taskId] ?? [];
      if (!grants.some((grant) => grant.folderId === folderId))
        throw new LedgerNotFound('Folder', folderId);
      await this.writeGrants(
        taskId,
        grants.filter((grant) => grant.folderId !== folderId),
      );
      return this.list(taskId);
    });
  }

  /** Drops every grant of a deleted task. */
  forget(taskId: string): Promise<void> {
    if (!this.state.grants[taskId]) return Promise.resolve();
    return this.serialize(() => this.writeGrants(taskId, []));
  }

  /** Gives a forked task the grants of its source, with the overview state it carries. */
  copy(fromTaskId: string, toTaskId: string): Promise<void> {
    const grants = this.state.grants[fromTaskId];
    if (!grants?.length) return Promise.resolve();
    return this.serialize(() => this.writeGrants(toTaskId, structuredClone(grants)));
  }

  /**
   * The grants a run of the task starts with, marking each introduced: the run's material
   * carries the overview of the ones not introduced yet. A folder that is no longer the directory
   * it was registered as (removed, or replaced by a link to elsewhere) is left out of the run.
   */
  startRun(taskId: string): Promise<RunFolderGrant[]> {
    return this.serialize(async () => {
      const grants = this.state.grants[taskId] ?? [];
      const started: RunFolderGrant[] = [];
      for (const grant of grants) {
        const [folder] = this.resolve([grant.folderId]);
        const checked = folder && (await checkFolder(folder.path, this.dataDir));
        if (folder && checked?.ok && checked.real === folder.path)
          started.push({ folder, introduce: !grant.introduced });
      }
      if (grants.some((grant) => !grant.introduced))
        await this.writeGrants(
          taskId,
          grants.map((grant) => ({ ...grant, introduced: true })),
        );
      return started;
    });
  }

  /** Writes are serialized so concurrent requests cannot interleave a read-modify-write. */
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.chain.then(action);
    this.chain = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private writeGrants(taskId: string, grants: Grant[]): Promise<void> {
    const { [taskId]: _previous, ...others } = this.state.grants;
    void _previous;
    return this.write({
      ...this.state,
      grants: grants.length ? { ...others, [taskId]: grants } : others,
    });
  }

  private async write(next: FoldersFile): Promise<void> {
    await atomicWrite(this.file, next);
    this.state = next;
  }
}
