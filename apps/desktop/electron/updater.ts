import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { app, dialog } from 'electron';
import log from 'electron-log/main';
import electronUpdater, { type AppUpdater, type UpdateCheckResult } from 'electron-updater';

const logger = log.scope('updater');
const execFileAsync = promisify(execFile);

/** Leaves launch work (service start, first window) ahead of the first network check. */
const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** What the updater is doing; the menus and the manual check read it. */
export type UpdateState =
  /** This build can never update itself; `reason` tells the user why. */
  | { status: 'disabled'; reason: string }
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'downloading'; version: string }
  /** Downloaded; installs at the next quit, or now through `restartToUpdate`. */
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string };

/**
 * The Developer ID team that signed this app bundle, or null for an ad-hoc or unsigned build.
 * Squirrel.Mac accepts an update only when it satisfies the running app's designated requirement;
 * an ad-hoc signature's requirement is its own cdhash, which no other build can match, so such a
 * build would download every update and then reject it.
 */
async function signingTeam(): Promise<string | null> {
  // process.execPath is <bundle>.app/Contents/MacOS/<executable>.
  const bundle = path.resolve(process.execPath, '../../..');
  try {
    const { stderr } = await execFileAsync('/usr/bin/codesign', [
      '--display',
      '--verbose=2',
      bundle,
    ]);
    const team = /^TeamIdentifier=(.+)$/m.exec(stderr)?.[1];
    return team === undefined || team === 'not set' ? null : team;
  } catch (error) {
    // codesign exits non-zero for a bundle that is not signed at all.
    logger.warn('Could not read the app signature:', error);
    return null;
  }
}

/** Why this build cannot update itself, or null when it can. */
async function disabledReason(): Promise<string | null> {
  if (!app.isPackaged) return 'Updates are only available in the packaged app.';
  // Releases publish update metadata for macOS only.
  if (process.platform !== 'darwin') return 'Automatic updates are only available on macOS.';
  // electron-builder writes the feed only for installer targets (dmg, zip), not `--dir` packs.
  if (!existsSync(path.join(process.resourcesPath, 'app-update.yml'))) {
    return 'This build has no update feed.';
  }
  if ((await signingTeam()) === null) {
    return 'This build is not signed with a Developer ID, so macOS cannot verify its updates. Download new versions from the releases page instead.';
  }
  return null;
}

async function inform(message: string, detail: string) {
  await dialog.showMessageBox({ type: 'info', message, detail, buttons: ['OK'] });
}

/**
 * The one owner of automatic updates through electron-updater and GitHub Releases. Construct it
 * once after the app is ready: it decides whether this build can update, then checks shortly after
 * launch and every few hours, downloading in the background. A downloaded update installs at the
 * next quit (`autoInstallOnAppQuit`) or through `restartToUpdate`.
 *
 * Prereleases follow electron-updater's default: a stable version reads GitHub's latest release,
 * which never is a prerelease, and a prerelease version (1.2.0-beta.1) also follows its channel.
 */
export class Updater {
  private state: UpdateState = { status: 'idle' };
  private readonly listeners = new Set<() => void>();
  /** Resolves once this build is known to update, with the configured updater, or not. */
  private readonly availability: Promise<{ updater: AppUpdater } | { disabled: string }>;

  constructor(
    private readonly options: {
      /**
       * Asks whether the app may quit now, such as while tasks are running. It runs before
       * `quitAndInstall()` because the install is committed once that is called: the quit guard
       * never prompts during an update quit.
       */
      confirmRestart: () => Promise<boolean>;
    },
  ) {
    this.availability = this.enable();
    void this.availability.then((availability) => {
      if (!('updater' in availability)) return;
      const { updater } = availability;
      setTimeout(() => this.checkInBackground(updater), FIRST_CHECK_DELAY_MS);
      setInterval(() => this.checkInBackground(updater), CHECK_INTERVAL_MS);
    });
  }

  get current(): UpdateState {
    return this.state;
  }

  /** Runs `listener` after every state change, for example to rebuild the application menu. */
  onChange(listener: () => void) {
    this.listeners.add(listener);
  }

  /** The menu's manual check: always ends in a native dialog describing the result. */
  async checkForUpdates(): Promise<void> {
    const availability = await this.availability;
    if (!('updater' in availability)) {
      return inform('Automatic updates are unavailable', availability.disabled);
    }
    const state = this.state;
    if (state.status === 'ready') return this.offerRestart(state.version);
    if (state.status === 'downloading') {
      return inform(
        `Downloading AI ${state.version}`,
        'Restart to Update appears in the AI menu when the download finishes.',
      );
    }
    let result: UpdateCheckResult | null;
    try {
      result = await this.check(availability.updater);
    } catch (error) {
      await dialog.showMessageBox({
        type: 'error',
        message: 'Could not check for updates',
        detail: error instanceof Error ? error.message : 'The update check failed.',
        buttons: ['OK'],
      });
      return;
    }
    // The download may already have finished from the cache while the check ran.
    if (this.state.status === 'ready') return this.offerRestart(this.state.version);
    if (result?.isUpdateAvailable) {
      await inform(
        `AI ${result.updateInfo.version} is available`,
        'It downloads in the background. Choose Restart to Update in the AI menu when it is ready, or it installs the next time you quit AI.',
      );
    } else {
      await inform('AI is up to date', `Version ${app.getVersion()} is the latest version.`);
    }
  }

  /**
   * Quits and relaunches into the downloaded update once `confirmRestart` agrees; declining keeps
   * the update ready for a later restart or quit. Electron closes every window first and then quits
   * through `before-quit`, where the quit guard stops the local service without asking again.
   */
  async restartToUpdate(): Promise<void> {
    if (this.state.status !== 'ready') return;
    if (!(await this.options.confirmRestart())) return;
    const availability = await this.availability;
    // A Squirrel.Mac failure may have replaced the ready update while the question was open.
    if (this.state.status !== 'ready' || !('updater' in availability)) return;
    logger.info(`Restarting to install ${this.state.version}`);
    availability.updater.quitAndInstall();
  }

  private set(state: UpdateState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  private async enable(): Promise<{ updater: AppUpdater } | { disabled: string }> {
    const reason = await disabledReason();
    if (reason !== null) {
      logger.info(`Automatic updates are off: ${reason}`);
      this.set({ status: 'disabled', reason });
      return { disabled: reason };
    }
    // Read only now: creating the macOS updater binds Squirrel.Mac to this app.
    const { autoUpdater } = electronUpdater;
    autoUpdater.logger = logger;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }));
    autoUpdater.on('update-not-available', () => this.set({ status: 'idle' }));
    autoUpdater.on('update-available', (info) =>
      this.set({ status: 'downloading', version: info.version }),
    );
    autoUpdater.on('update-downloaded', (event) =>
      this.set({ status: 'ready', version: event.version }),
    );
    // Also reports Squirrel.Mac failures after `update-downloaded`, such as a rejected signature.
    autoUpdater.on('error', (error) => this.set({ status: 'error', message: error.message }));
    return { updater: autoUpdater };
  }

  /** A scheduled check; skipped while one is running or an update is on its way. */
  private checkInBackground(updater: AppUpdater) {
    const { status } = this.state;
    if (status === 'checking' || status === 'downloading' || status === 'ready') return;
    // The `error` event has already recorded and logged the failure.
    this.check(updater).catch(() => undefined);
  }

  private async check(updater: AppUpdater): Promise<UpdateCheckResult | null> {
    const result = await updater.checkForUpdates();
    // A failed download rejects this promise and emits `error`, which records it; nothing else
    // awaits the promise, so it would otherwise be an unhandled rejection.
    result?.downloadPromise?.catch(() => undefined);
    return result;
  }

  private async offerRestart(version: string) {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      message: `AI ${version} is ready to install`,
      detail: 'Restart now to update, or it installs the next time you quit AI.',
      buttons: ['Restart to Update', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) await this.restartToUpdate();
  }
}
