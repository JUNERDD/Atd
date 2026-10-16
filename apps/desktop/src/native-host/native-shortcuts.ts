import { doubleTapModifier, keyedShortcuts, type CommandShortcut } from '@atd/agent-contracts';
import i18n from '../i18n';
import type { CommandLaunch } from '../client/agent/bridge';
import { argumentOverrides } from '../client/agent/command-arguments';
import { runsAsIs, withoutSelectionNotice } from '../client/agent/command-prepare';
import type { CommandDefinition } from '../client/agent/command-schema';
import { withOutputAction } from '../client/agent/run-output';
import { errorMessage } from '../client/agent/validation';
import type { NativeBridge, ShortcutResult } from '../native-bridge/client';
import {
  MAX_SHORTCUT_REGISTRATIONS,
  PANEL_SHORTCUT_ID,
  SCREENSHOT_SHORTCUT_ID,
} from '../native-bridge/calls';
import type { NativeCommands } from './native-commands';
import type { WindowMessage, WindowMessages } from './window-messages';

type RegistrationFailure = Extract<ShortcutResult, { registered: false }>['reason'];

/** Whether the shell holds each of the app's own global shortcuts. */
export interface GlobalShortcutState {
  panelAvailable: boolean;
  screenshotAvailable: boolean;
}

/** Command shortcuts the shell can take beside the app's own two (`MAX_SHORTCUT_REGISTRATIONS`). */
const MAX_COMMAND_REGISTRATIONS = MAX_SHORTCUT_REGISTRATIONS - 2;

/** A command shortcut the shell registers, under the shortcut's id, with the command it runs. */
export interface ShortcutRegistration {
  command: CommandDefinition;
  shortcut: CommandShortcut;
}

/**
 * The command shortcuts the panel asks the shell to register, in command-list order: each keyed
 * shortcut of each enabled command, at most `MAX_COMMAND_REGISTRATIONS`; `excess` holds the ones
 * past that, which are not registered and report the too-many error instead.
 */
export function shortcutRegistrations(commands: readonly CommandDefinition[]): {
  registered: ShortcutRegistration[];
  excess: ShortcutRegistration[];
} {
  const all = commands
    .filter((command) => command.enabled)
    .flatMap((command) => keyedShortcuts(command).map((shortcut) => ({ command, shortcut })));
  return {
    registered: all.slice(0, MAX_COMMAND_REGISTRATIONS),
    excess: all.slice(MAX_COMMAND_REGISTRATIONS),
  };
}

/**
 * Why a command shortcut did not register, in the app's language. An unavailable double-tap
 * without Accessibility access (`trusted` false) needs that access rather than other keys.
 */
function registrationError(
  reason: RegistrationFailure | 'tooMany',
  doubleTap: boolean,
  trusted: boolean | null,
): string {
  const key =
    reason === 'unavailable' && doubleTap && trusted === false ? 'doubleTapAccessibility' : reason;
  return i18n.t(`shortcut.registration.${key}`, { ns: 'commands' });
}

export interface ShortcutSync {
  /**
   * Pushes the current set when it changed, or always with `force` (a command changed, so its
   * registration error must be reported again). Calls made while one is in flight collapse into
   * one more push.
   */
  sync(force?: boolean): void;
}

/**
 * The panel's side of the global shortcuts. The shell registers whatever set the panel pushes (the
 * panel and screenshot shortcuts plus each keyed shortcut of each enabled command, registered
 * under the shortcut's own id) and reports every item; conflicts between the app's own shortcuts
 * stay with the service and the settings checks. `commands.errors` takes each registration
 * failure under the shortcut's id and each launch failure under the command's id. A command
 * shortcut arrives as `{ id, target?, arguments?, intent? }` after the shell captured the
 * selection: an id the last pushed set registered names that shortcut, and any other id (the
 * selection toolbar, the mini panel) a command. It is prepared with the capture expected, the
 * shortcut's pinned values and the shell's picks over the remembered values, carrying the write
 * target along; the answer goes where the shell's pick says for this run, else where the
 * shortcut's, else the command's saved output says. Then by `intent`: `run` (or none) launches it
 * as the desktop's shortcut does, running it when it can be used as-is; `edit` shows its input
 * step and never runs it; `choose` asks the panel to offer its options first
 * (`CommandLaunch.choose`). A `run` or `choose` launch whose selection was missing carries that
 * to the launch channel, which asks for the text first; `edit` shows the input step, where the
 * text is typed, without reporting it. The screenshot shortcut is the panel page's to run
 * (`DesktopBridge.onScreenshotShortcut`).
 */
export function nativeShortcuts(
  bridge: NativeBridge,
  commands: NativeCommands,
  messages: WindowMessages,
  host: {
    /** The app's global accelerators, or null while the service's settings have not loaded. */
    appShortcuts: () => { togglePanel: string; captureScreenshot: string } | null;
    /** Every push result: which app shortcuts hold, after `commands.errors` changed. */
    applied: (state: GlobalShortcutState) => void;
    launch: (launch: CommandLaunch) => void;
  },
): ShortcutSync {
  let running = false;
  let again = false;
  /** The set the shell last took; an identical set is not pushed again. */
  let pushed = '';
  /** What each command shortcut the shell last took launches, by registration id. */
  let routes = new Map<string, { commandId: string; shortcutId: string }>();
  /** The shell's answer to that set, shared with settings windows; null before the first. */
  let state: Extract<WindowMessage, { type: 'shortcutState' }> | null = null;
  /** The shell's Accessibility trust, which a double-tap needs; null before it reports it. */
  let trusted: boolean | null = null;
  messages.listen((message) => {
    if (message.type === 'shortcutStateRequest' && state) messages.post(state);
  });

  async function push() {
    const app = host.appShortcuts();
    if (app === null) return;
    const list = commands.list();
    const { registered, excess } = shortcutRegistrations(list);
    const params = {
      registrations: [
        { id: PANEL_SHORTCUT_ID, accelerator: app.togglePanel },
        { id: SCREENSHOT_SHORTCUT_ID, accelerator: app.captureScreenshot },
        ...registered.map(({ shortcut }) => ({
          id: shortcut.id,
          accelerator: shortcut.accelerator,
        })),
      ],
      selectionWanted: list.some((command) => command.enabled && command.input.selection),
    };
    const signature = JSON.stringify(params);
    if (signature === pushed) return;
    const { results } = await bridge.call('shortcuts.set', params);
    pushed = signature;
    routes = new Map(
      registered.map(({ command, shortcut }) => [
        shortcut.id,
        { commandId: command.id, shortcutId: shortcut.id },
      ]),
    );
    const doubleTaps = new Set(
      params.registrations.flatMap(({ id, accelerator }) =>
        doubleTapModifier(accelerator) ? [id] : [],
      ),
    );
    const available: GlobalShortcutState = { panelAvailable: false, screenshotAvailable: false };
    for (const id of Object.keys(commands.errors)) delete commands.errors[id];
    for (const result of results) {
      if (result.id === PANEL_SHORTCUT_ID) available.panelAvailable = result.registered;
      else if (result.id === SCREENSHOT_SHORTCUT_ID)
        available.screenshotAvailable = result.registered;
      else if (!result.registered)
        commands.errors[result.id] = registrationError(
          result.reason,
          doubleTaps.has(result.id),
          trusted,
        );
    }
    for (const { shortcut } of excess)
      commands.errors[shortcut.id] = registrationError('tooMany', false, trusted);
    host.applied(available);
    state = { type: 'shortcutState', ...available, errors: { ...commands.errors } };
    messages.post(state);
  }

  async function run() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await push().catch((error: unknown) => {
          console.error('The native shell did not take the shortcut set:', error);
        });
      } while (again);
    } finally {
      running = false;
    }
  }

  // A double-tap registers only with Accessibility access, which the shell re-applies as it
  // changes; pushing again learns the new answer for the settings and the command errors.
  bridge.on('accessibility.trust', ({ trusted: now }) => {
    if (trusted !== null && trusted !== now) {
      pushed = '';
      void run();
    }
    trusted = now;
  });

  // The target is the field the summon found focused in another app; a write-back output writes
  // the answer there once the run completes.
  bridge.on('shortcut.command', ({ id, target, arguments: picked, intent = 'run' }) => {
    const { commandId, shortcutId } = routes.get(id) ?? { commandId: id, shortcutId: undefined };
    // Async, so a throw (`find` of a deleted command) rejects into the catch below.
    void (async () =>
      commands.prepare(
        commandId,
        true,
        picked && argumentOverrides(commands.find(commandId), picked),
        shortcutId,
      ))()
      .then((prepared) => {
        const launched = withOutputAction(
          target ? { ...prepared, target } : prepared,
          picked?.output,
        );
        if (intent === 'run') host.launch({ prepared: launched, autoRun: runsAsIs(launched) });
        else if (intent === 'edit')
          host.launch({ prepared: withoutSelectionNotice(launched), autoRun: false });
        else host.launch({ prepared: launched, autoRun: false, choose: true });
      })
      .catch((error: unknown) => {
        commands.errors[commandId] = errorMessage(error);
      });
  });

  return {
    sync: (force = false) => {
      if (force) pushed = '';
      void run();
    },
  };
}

/**
 * A settings window's side of the registration results: it never pushes a set, so it takes the
 * panel's answers into its own command errors (keyed as the panel keys them) and reports which
 * app shortcuts hold.
 */
export function followShortcutState(
  messages: WindowMessages,
  commands: NativeCommands,
  applied: (state: GlobalShortcutState) => void,
): void {
  messages.listen((message) => {
    if (message.type !== 'shortcutState') return;
    for (const id of Object.keys(commands.errors)) delete commands.errors[id];
    Object.assign(commands.errors, message.errors);
    applied({
      panelAvailable: message.panelAvailable,
      screenshotAvailable: message.screenshotAvailable,
    });
  });
  messages.post({ type: 'shortcutStateRequest' });
}
