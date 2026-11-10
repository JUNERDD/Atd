import { useEffect, useLayoutEffect, useRef } from 'react';
import type { LightHost } from './light-command';
import { actOnIsland, connectIslandHost, followIsland } from './island-owner';
import { followRecordingAsks, listenRecordingAsks } from './recording-asks';

/**
 * Wires light command runs (`light-command.ts`), the review card of one whose answer waits for
 * review (`light-review.ts`), their options card (`light-command-choose.ts`), the compose card
 * of a launch with nothing selected (`light-command-compose.ts`), the screenshot toolbar's island
 * runs (`light-capture.ts`) and the questions about a recording (`recording-asks.ts`) to the
 * panel: presses on the shell's progress HUD, and a run that asks the person something, show the
 * run or the command's input step in the panel through `host`.
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
    const disconnectHost = connectIslandHost(() => latest.current);
    const stopActions = light.onAction((action) => actOnIsland(action, latest.current));
    const stopChanges = agent.onChange((event) => {
      followIsland(event);
      followRecordingAsks(event, latest.current);
    });
    const recordingAsks = window.desktop?.capture?.recordingAsks;
    const stopAsks = recordingAsks
      ? listenRecordingAsks(recordingAsks, light, () => latest.current)
      : undefined;
    return () => {
      disconnectHost();
      stopActions();
      stopChanges();
      stopAsks?.();
    };
  }, []);
}
