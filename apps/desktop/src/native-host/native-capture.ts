import { answersInPlace } from '@atd/agent-contracts';
import type { CommandLaunch, PreparedCommand, WriteTarget } from '../client/agent/bridge';
import { argumentOverrides } from '../client/agent/command-arguments';
import { runsAsIs, withoutSelectionNotice } from '../client/agent/command-prepare';
import { withOutputAction } from '../client/agent/run-output';
import type { Screenshot } from '../client/agent/screenshot-input';
import type { CaptureBridge, CaptureMode, CaptureOutcome } from '../client/capture-bridge';
import type { CallResult, NativeBridge } from '../native-bridge/client';
import { shotOf, type NativeCommands } from './native-commands';

type CaptureLaunch = NonNullable<Extract<CallResult<'screenshot.capture'>, { ok: true }>['launch']>;

/**
 * The command picked on the screenshot toolbar, prepared on the screenshot `shot` with the values
 * picked in its options, its answer going where the pick says (else where the command's saved
 * output does). An answer typed at the cursor goes into `target`, the field focused before the
 * capture; without one it gets a target of its own that nothing is written to (`writable` false),
 * so the answer still shows on the island's answer card, as an answer meant for that card always
 * does. Only those runs keep a target (`answersInPlace`); the others go to the conversation or the
 * clipboard.
 */
async function preparedLaunch(
  commands: NativeCommands,
  { id, arguments: picked }: Extract<CaptureLaunch, { kind: 'command' }>,
  shot: Screenshot,
  target: WriteTarget | undefined,
): Promise<PreparedCommand> {
  const prepared = await commands.prepareWithScreenshot(
    id,
    shot,
    picked && argumentOverrides(commands.find(id), picked),
  );
  const keyed = {
    ...prepared,
    target: target ?? { id: crypto.randomUUID(), app: '', writable: false },
  };
  const launched = withOutputAction(keyed, picked?.output);
  if (answersInPlace(launched.output.action)) return launched;
  const { target: _target, ...withoutTarget } = launched;
  return withoutTarget;
}

/**
 * The composer's capture, capture shortcuts and recordings' questions for the panel's page
 * (`CaptureBridge`). A capture runs with the screenshot toolbar; a command picked there goes to the
 * launch channel (`launch`) as a command shortcut's does: by its `intent`, running when it can be
 * used as-is, opened in the panel to fill in (`edit`), or with its options shown (`choose`).
 */
export function nativeCapture(
  native: NativeBridge,
  commands: NativeCommands,
  launch: (launch: CommandLaunch) => void,
  events: Pick<CaptureBridge, 'onShortcut' | 'recordingAsks'>,
): CaptureBridge {
  async function capture(mode: CaptureMode): Promise<CaptureOutcome> {
    const result = await native.call('screenshot.capture', { purpose: 'capture', mode });
    const shot = shotOf(result);
    if (!shot || !result.ok) return { kind: 'none' };
    if (!result.launch) return { kind: 'attach', shot };
    if (result.launch.kind === 'ask')
      return { kind: 'ask', shot, question: result.launch.question };
    const prepared = await preparedLaunch(commands, result.launch, shot, result.target);
    const { intent = 'run' } = result.launch;
    if (intent === 'run') launch({ prepared, autoRun: runsAsIs(prepared), fromCapture: true });
    else if (intent === 'edit')
      launch({ prepared: withoutSelectionNotice(prepared), autoRun: false, fromCapture: true });
    else launch({ prepared, autoRun: false, choose: true, fromCapture: true });
    return { kind: 'launched' };
  }
  return {
    ...events,
    capture,
  };
}
