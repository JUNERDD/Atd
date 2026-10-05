import path from 'node:path';

/** Name prefix of a build revision's directory under `versions/`. */
export const REVISION_PREFIX = '.rev-';

/**
 * Where the service keeps user apps (plan "数据模型"). Everything lives under `<dataDir>/apps`,
 * which agent file tools may not write (service-fs.ts `protectedWriteRoots`):
 *
 * ```
 * apps/
 *   index.json               revision and app summaries (AppStore)
 *   .work/                   build scratch, sandbox profiles and the self-check (service-owned)
 *   <appId>/
 *     app.json               the app record
 *     versions/<n>           version n: a link to the build that last wrote it (versions.ts)
 *     versions/.rev-<k>/     web/, server/, source/, icon.svg, version.json of build revision k
 *                            (immutable)
 *     data/                  the backend's only writable directory, shared by every version
 *     widgets/               the latest widget snapshots
 *     diagnostics.jsonl      the diagnostics ring
 * ```
 */
export class AppPaths {
  readonly root: string;

  constructor(readonly dataDir: string) {
    this.root = path.join(dataDir, 'apps');
  }

  get indexFile(): string {
    return path.join(this.root, 'index.json');
  }

  /** Scratch the service owns: build work directories, profiles, the sandbox self-check. */
  get workDir(): string {
    return path.join(this.root, '.work');
  }

  get profilesDir(): string {
    return path.join(this.workDir, 'profiles');
  }

  app(appId: string): string {
    return path.join(this.root, appId);
  }

  appFile(appId: string): string {
    return path.join(this.app(appId), 'app.json');
  }

  versionsDir(appId: string): string {
    return path.join(this.app(appId), 'versions');
  }

  /** Version n's files, through its link (a plain directory before build revisions). */
  version(appId: string, n: number): string {
    return path.join(this.versionsDir(appId), String(n));
  }

  /** The files of build revision `revision`, which version links point to. */
  revision(appId: string, revision: number): string {
    return path.join(this.versionsDir(appId), `${REVISION_PREFIX}${revision}`);
  }

  data(appId: string): string {
    return path.join(this.app(appId), 'data');
  }

  widgets(appId: string): string {
    return path.join(this.app(appId), 'widgets');
  }

  diagnostics(appId: string): string {
    return path.join(this.app(appId), 'diagnostics.jsonl');
  }

  /** The task output directory a task's `app` tool builds from (the task cwd). */
  taskOutput(taskId: string): string {
    return path.join(this.dataDir, 'tasks', taskId, 'output');
  }
}
