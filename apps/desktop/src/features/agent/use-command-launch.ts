import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PreparedCommand, TaskDetail } from '../../client/agent/bridge';
import { needsInput } from '../../client/agent/command-arguments';
import { showErrorToast } from '../../components/toast-store';
import { startLightCopy } from './light-capture';
import { startLightRun } from './light-command';
import { isLightLaunch } from './light-command-run';
import { chooseLightRun } from './light-command-choose';
import { composeLightRun } from './light-command-compose';
import { useCommandResults } from './use-command-results';
import { useLightCommands } from './use-light-commands';
import { showPanel } from './use-panel-window';

/**
 * The global launch channel (`AgentBridge.onLaunch`): command shortcut presses, the settings
 * window's runs and the native selection toolbar over other apps. A launch that runs as-is never
 * shows the command input: `submit` opens its starting conversation at once and sends its run,
 * revealing the panel immediately before the service answers. Any other launch,
 * and a run that cannot start (with its failure), shows the command's input page (`showInput`).
 * Either way the panel is revealed once the launched view is on screen. A light launch (one that
 * runs as-is and whose answer lands in or over the app it ran from: written back, or on the
 * island's answer card, `isLightLaunch`) is the exception: it leaves the panel hidden and as it was, and the shell's progress HUD reports it
 * (an answer under review waits on the HUD's review card, never written by itself); the panel
 * shows its task (`openTask`) only when the run needs the person or they open it; a held shortcut
 * first offers a light launch's options in that HUD (`chooseLightRun`). A shell launch that found
 * nothing selected for a command working on the selection (`PreparedCommand.selectionMissing`)
 * leaves the panel hidden too: the HUD's compose card asks for the text, after the options card
 * for a held shortcut, and the launch goes on from its answer (`composeLightRun`). A run the
 * screenshot toolbar launched whose answer is copied (`CommandLaunch.fromCapture`) runs on the
 * island as well, which confirms the copy (`startLightCopy`). It also acts on the answers of the
 * command runs the panel started (`useCommandResults`).
 */
export function useCommandLaunch({
  submit,
  showInput,
  openTask,
}: {
  submit: (launched: PreparedCommand, onStart?: () => void) => Promise<TaskDetail | null>;
  showInput: (prepared: PreparedCommand) => void;
  openTask: (taskId: string) => void;
}): void {
  useCommandResults();
  const [revealCount, setRevealCount] = useState(0);
  // The panel as of the latest commit: a launch arrives, and a run settles, after renders the
  // press did not see.
  const latest = useRef({ submit, showInput });
  useLayoutEffect(() => {
    latest.current = { submit, showInput };
  });
  // `submit` opens the starting task view synchronously and calls `reveal` before awaiting the
  // service, so the commit that reveals the panel already renders that view with no HTTP wait.
  const runInPanel = useCallback((prepared: PreparedCommand) => {
    const reveal = () => setRevealCount((count) => count + 1);
    void latest.current.submit(prepared, reveal).catch((error: unknown) => {
      latest.current.showInput(prepared);
      showErrorToast(error);
      reveal();
    });
  }, []);
  useLightCommands({
    openTask,
    showInput,
    reveal: () => setRevealCount((count) => count + 1),
    run: runInPanel,
  });
  useEffect(() => {
    const bridge = window.desktop?.agent;
    if (!bridge) return;
    return bridge.onLaunch(({ prepared, autoRun: run, choose, fromCapture }) => {
      const { light } = bridge;
      if (light && fromCapture && run && prepared.output.action === 'copy') {
        void startLightCopy(prepared, light).catch((error: unknown) => {
          console.error('The light copy run failed:', error);
        });
        return;
      }
      if (light && prepared.selectionMissing) {
        composeLightRun(prepared, choose === true, light);
        return;
      }
      if (light && isLightLaunch(prepared)) {
        // A held shortcut offers the options of a light launch whose capture worked and whose
        // text and number parameters have values (the card fills only choices and toggles, and
        // where the answer goes); any other `choose` launch shows its input step, where the
        // options are too.
        const { command, input, notice } = prepared;
        if (choose && !notice && !needsInput(command, input.arguments)) {
          chooseLightRun(prepared, light);
          return;
        }
        if (run) {
          void startLightRun(prepared, light).catch((error: unknown) => {
            console.error('The light command run failed:', error);
          });
          return;
        }
      }
      if (run) {
        runInPanel(prepared);
        return;
      }
      latest.current.showInput(prepared);
      setRevealCount((count) => count + 1);
    });
  }, [runInPanel]);
  useEffect(() => {
    if (revealCount) void showPanel();
  }, [revealCount]);
}
