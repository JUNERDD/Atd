import path from 'node:path';

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
 *     versions/<n>/          web/, server/, source/, icon.svg, version.json (immutable)
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

  version(appId: string, n: number): string {
    return path.join(this.versionsDir(appId), String(n));
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
