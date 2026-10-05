import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PreparedCommand, TaskDetail } from '../../client/agent/bridge';
import { showErrorToast } from '../../components/toast-store';
import { showPanel } from './use-panel-window';

/**
 * The global launch channel (`AgentBridge.onLaunch`): command shortcut presses, the settings
 * window's runs and the native selection toolbar over other apps. A launch that runs as-is never
 * shows the command input: `submit` starts its task, which the panel then shows. Any other launch,
 * and a run that cannot start (with its failure), shows the command's input page (`showInput`).
 * Either way the panel is revealed once the launched view is on screen.
 */
export function useCommandLaunch({
  submit,
  showInput,
}: {
  submit: (launched: PreparedCommand) => Promise<TaskDetail | null>;
  showInput: (prepared: PreparedCommand) => void;
}): void {
  const [autoRun, setAutoRun] = useState<PreparedCommand | null>(null);
  const [revealCount, setRevealCount] = useState(0);
  // The panel as of the latest commit: a launch arrives, and a run settles, after renders the
  // press did not see.
  const latest = useRef({ submit, showInput });
  useLayoutEffect(() => {
    latest.current = { submit, showInput };
  });
  // The reveal counter is raised together with the launched view, so the commit that reveals the
  // panel already renders that view.
  useEffect(() => {
    const bridge = window.desktop?.agent;
    if (!bridge) return;
    return bridge.onLaunch(({ prepared, autoRun: run }) => {
      if (run) {
        setAutoRun(prepared);
        return;
      }
      latest.current.showInput(prepared);
      setRevealCount((count) => count + 1);
    });
  }, []);
  // Every launch is a fresh object, so this runs exactly once per press.
  useEffect(() => {
    if (!autoRun) return;
    void latest.current
      .submit(autoRun)
      .then((detail) => {
        if (detail) setRevealCount((count) => count + 1);
      })
      .catch((error: unknown) => {
        latest.current.showInput(autoRun);
        showErrorToast(error);
        setRevealCount((count) => count + 1);
      });
  }, [autoRun]);
  useEffect(() => {
    if (revealCount) void showPanel();
  }, [revealCount]);
}
