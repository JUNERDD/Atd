import { useEffect, useLayoutEffect, useRef } from 'react';
import { followLightRun, type LightHost } from './light-command';
import { actOnLightAction } from './light-command-choose';

/**
 * Wires light command runs (`light-command.ts`) and their options card (`light-command-choose.ts`)
 * to the panel: presses on the shell's progress HUD, and a run that asks the person something,
 * show the run or the command's input step in the panel through `host`.
 * Mounted once, by the panel's launch channel.
 */
export function useLightCommands(host: LightHost): void {
  // The panel as of the latest commit: a press or an event arrives after renders it did not see.
  const latest = useRef(host);
  useLayoutEffect(() => {
    latest.current = host;
  });
  useEffect(() => {
    const agent = window.desktop?.agent;
    const light = agent?.light;
    if (!agent || !light) return;
    const stopActions = light.onAction((action) => actOnLightAction(action, latest.current));
    const stopChanges = agent.onChange((event) => followLightRun(event, latest.current));
    return () => {
      stopActions();
      stopChanges();
    };
  }, []);
}
