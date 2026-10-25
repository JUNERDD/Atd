import { COMPUTER_ENGINE_FOR_KIND } from '@atd/agent-contracts';
import { type CallBase, type ToolAnswer } from './call-context.js';
import { computerDetails } from './details.js';

/**
 * Setup is available before a target is selected; it reveals no app or window contents. Apps run
 * on the engine built into Atd; websites need the browser engine's add-on.
 */
export function computerSetup(ctx: CallBase): ToolAnswer {
  const { runtime } = ctx;
  return {
    text: JSON.stringify({
      targets: [],
      reason: 'noTargetsSelected',
      host: runtime.coordinator.hostStatus().state,
      engines: {
        browser: { installed: runtime.engineInstalled(COMPUTER_ENGINE_FOR_KIND.browser) },
        desktop: { installed: runtime.engineInstalled(COMPUTER_ENGINE_FOR_KIND.native) },
      },
      next: 'Call requestAccess now for the application or website the task needs, with its name or URL and purpose. It applies the task approval mode, opens the approved target in the background and continues this run. Auto and Always save approved access in Settings → Computer use; Manual is temporary for this run. Apps need nothing installed; a website needs the browser engine, which the person installs in Settings → Computer use → Engines only if it is missing. Do not bypass target authorization with shell scripts or other computer-control tools.',
    }),
    details: computerDetails({ op: 'targets' }),
  };
}
