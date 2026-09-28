import { app, autoUpdater, dialog, powerMonitor } from 'electron';
import type { BrowserWindow, MessageBoxOptions } from 'electron';
import type { ServiceManager } from './service/manager';

/** How long a quit waits for the service's run count before it treats the service as idle. */
const STATUS_TIMEOUT_MS = 1500;

/**
 * Signals that end the process without anyone at the app: the dev runner (vite-plugin-electron
 * kills Electron with SIGTERM on every main-process rebuild), Ctrl+C, `kill` and a closed terminal.
 */
const QUIT_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;

export interface QuitGuardDeps {
  /** The service owner once startup created the task client; a quit before that needs no teardown. */
  service: () => Pick<ServiceManager, 'connection' | 'shutdown'> | undefined;
  /** Closes the task client; runs after the service stopped. */
  closeAgent: () => Promise<void>;
  /** A cancelled quit keeps the app running; outside macOS closing the panel quits, so restore it. */
  onCancelled: () => void;
  /**
   * Reveals the window the prompt attaches to, or null when none can show. On macOS a message
   * box without a parent runs synchronously: the main process stops until it is answered, so a
   * signal or OS shutdown could neither close it nor quit. A sheet keeps the event loop running.
   */
  promptParent: () => BrowserWindow | null;
}

export interface QuitGuard {
  /** True once teardown or an update install started; windows may close for real from then on. */
  isQuitting: () => boolean;
  /**
   * Asks, as a quit does, whether to stop running tasks, for a caller about to start a quit that
   * cannot be cancelled later (an update install). True when nothing runs or the user chose to
   * restart; false when they declined or a quit is already asking.
   */
  confirmStopTasks: () => Promise<boolean>;
}

/**
 * Owns the app's quit flow. Stopping the service cancels its started runs (queued runs stay queued
 * and start the next time the service boots), so a quit someone asked for at the app first asks
 * whether to stop running tasks. The teardown order is `service.shutdown()`, then `closeAgent()`,
 * then `app.quit()`; once it starts, every later quit passes straight through, so a second quit
 * still ends a hung teardown.
 *
 * Unattended quits never ask: OS shutdown or logout (`powerMonitor` 'shutdown' on macOS and
 * Linux, a window's 'session-end' on Windows, where a session end emits no before-quit at all),
 * termination signals, and update installs. A prompt that is already open when one arrives is
 * closed and the teardown starts without waiting for its answer; on macOS that needs the prompt
 * to be a sheet (see `promptParent`), and a quit without a window to attach it to still blocks. A shutdown notice has no matching "cancelled" event, so after an
 * OS shutdown that another app vetoes, later quits in this session no longer ask.
 *
 * Update installs: `autoUpdater.quitAndInstall()` (Electron's, or electron-updater's, which emits
 * the same 'before-quit-for-update') has already committed to the install when before-quit runs —
 * on macOS the windows are closed first and Squirrel waits for the process to exit; on Windows and
 * Linux electron-updater has already spawned the installer. Cancelling at that point would leave a
 * windowless app with an install pending, so an update quit is never cancellable here. Whoever
 * calls `quitAndInstall()` should ask first while the app can still stay open; when that caller
 * declines, the downloaded update stays pending until a later install or quit.
 */
export function installQuitGuard(deps: QuitGuardDeps): QuitGuard {
  let unattended = false;
  let updating = false;
  let tearingDown = false;
  /** Set right before the teardown's own final quit, the only quit an update quit lets through. */
  let releasing = false;
  /** The pending ask: the run-count probe and then the dialog. Never more than one at a time. */
  let asking: AbortController | null = null;

  const teardown = () => {
    tearingDown = true;
    asking?.abort();
    asking = null;
    void (async () => {
      try {
        await deps.service()?.shutdown();
        await deps.closeAgent();
      } finally {
        releasing = true;
        app.quit();
      }
    })();
  };

  const ask = async (service: Pick<ServiceManager, 'connection'>) => {
    const controller = new AbortController();
    asking = controller;
    try {
      const count = await activeRunCount(service);
      const confirmed =
        count === 0 ||
        (!controller.signal.aborted &&
          (await confirmStop(count, 'quit', controller.signal, deps.promptParent())));
      // An unattended quit meanwhile already started the teardown.
      if (controller.signal.aborted) return;
      // The prompt is answered; clearing it first keeps teardown from closing a closed box.
      asking = null;
      if (confirmed) teardown();
      else deps.onCancelled();
    } finally {
      if (asking === controller) asking = null;
    }
  };

  /** Signals quit on their own; a repeated signal passes through a running teardown. */
  const quitOnSignal = () => {
    unattended = true;
    app.quit();
  };

  /**
   * The OS drives its own quit after a shutdown notice (macOS asks the app to terminate, Linux
   * sends SIGTERM, Windows ends the process), so only an open prompt needs a quit from here.
   */
  const onSessionEnd = () => {
    unattended = true;
    if (asking) app.quit();
  };

  app.on('before-quit', (event) => {
    const service = deps.service();
    if (!service) return;
    if (tearingDown) {
      // A second quit normally passes, so quitting again ends a hung teardown. During an update,
      // Squirrel.Mac terminates the app itself once the windows closed; the installer already
      // waits for the process to exit, so that quit is held until the service has stopped.
      if (updating && !releasing) event.preventDefault();
      return;
    }
    event.preventDefault();
    if (unattended || updating) teardown();
    else if (!asking)
      void ask(service).catch((error: unknown) => {
        // The quit stays cancelled; the next one asks again.
        console.error('Could not confirm the quit:', error);
      });
  });
  // On macOS the update quit closes every window before before-quit, so the panel's hide-on-close
  // must already let go here.
  autoUpdater.on('before-quit-for-update', () => {
    updating = true;
  });
  app.on('browser-window-created', (_event, window) => {
    window.on('session-end', onSessionEnd);
  });
  // powerMonitor is usable only once the app is ready.
  void app.whenReady().then(() => {
    powerMonitor.on('shutdown', onSessionEnd);
    // Electron installs its own handler for these signals, which only calls app.quit(), after
    // main.js has loaded, and it replaces listeners added earlier; registered once the app is
    // ready, these replace it instead. A signal before then still quits through Electron's.
    for (const signal of QUIT_SIGNALS) process.on(signal, quitOnSignal);
  });

  const confirmStopTasks = async (): Promise<boolean> => {
    const service = deps.service();
    if (!service) return true;
    if (asking || tearingDown) return false;
    const controller = new AbortController();
    asking = controller;
    try {
      const count = await activeRunCount(service);
      if (count === 0) return !controller.signal.aborted;
      return (
        !controller.signal.aborted &&
        (await confirmStop(count, 'restart', controller.signal, deps.promptParent()))
      );
    } finally {
      if (asking === controller) asking = null;
    }
  };

  return { isQuitting: () => tearingDown || updating, confirmStopTasks };
}

/** The service's started and queued runs; an unreachable or slow service counts as idle. */
async function activeRunCount(service: Pick<ServiceManager, 'connection'>): Promise<number> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<number>((resolve) => {
    timer = setTimeout(() => resolve(0), STATUS_TIMEOUT_MS);
  });
  try {
    const refreshed = service.connection
      .refresh()
      .then((status) => status.service?.activeRuns ?? 0);
    return await Promise.race([refreshed, timeout]);
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves true when the user chose to go on; an aborted dialog resolves like Cancel. */
async function confirmStop(
  count: number,
  action: 'quit' | 'restart',
  signal: AbortSignal,
  parent: BrowserWindow | null,
): Promise<boolean> {
  // A menu-bar app is often not frontmost when it is quit (Dock menu, another app's request).
  if (process.platform === 'darwin') app.focus({ steal: true });
  const options: MessageBoxOptions = {
    type: 'warning',
    title: action === 'quit' ? `Quit ${app.name}?` : `Restart ${app.name} to update?`,
    message: count === 1 ? '1 task is still running.' : `${count} tasks are still running.`,
    detail: `${action === 'quit' ? 'Quitting' : 'Restarting'} stops them. Queued tasks stay queued and start the next time ${app.name} opens.`,
    buttons: [action === 'quit' ? 'Quit' : 'Restart', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    signal,
  };
  const { response } = await (parent
    ? dialog.showMessageBox(parent, options)
    : dialog.showMessageBox(options));
  return response === 0;
}
