import { writesBack, type CommandWriteAction } from '@atd/agent-contracts';
import type {
  CommandProgressState,
  LightCommandBridge,
  PreparedCommand,
  WriteTarget,
} from '../../client/agent/bridge';
import type { Review } from './light-review';
import { agentApi } from './use-agent';

/**
 * A launch that runs without the panel: it runs as-is and its answer goes back into the field it
 * ran from (recorded as `target`). The shell's progress HUD stands in for the panel
 * (`LightCommandBridge`). An unreviewed answer is written there; where the field cannot take it
 * (`target.writable` is false, or the write is refused), the HUD shows it as an answer card
 * instead. An answer under review (`output.review`) is never written by itself: the HUD's review
 * card shows it, and the person writes, adjusts or regenerates it there (`light-review.ts`).
 */
export type LightLaunch = PreparedCommand & {
  target: WriteTarget;
  output: { action: CommandWriteAction };
};

export function isLightLaunch(prepared: PreparedCommand): prepared is LightLaunch {
  return writesBack(prepared.output.action) && prepared.target !== undefined;
}

/** One light launch, from its first run to its end (or its review's end). */
export interface LightRun {
  launch: LightLaunch;
  taskId: string | null;
  /** The run the HUD follows: the launch's own run, then the review's newest run. */
  runId: string | null;
  /** Why the run could not start; its notice's Open shows the input step with it. */
  error: unknown;
  /**
   * The person cancelled it, a newer launch replaced it, or its review card went: whatever of it
   * still runs stops, and its end shows nothing.
   */
  cancelled: boolean;
  /** The panel shows it (it asked for the person, or Open): its end acts as any other run's. */
  handedOver: boolean;
  /** The review its first answer started (`output.review`); null before, and without review. */
  review: Review | null;
}

interface LightRuns {
  /** The run whose HUD shows; a newer light launch replaces it. */
  current: LightRun | null;
  /** Light runs by the id of each of their runs still going, until that run ends. */
  readonly holding: Map<string, LightRun>;
}

export const lightRuns: LightRuns = { current: null, holding: new Map() };

export function lightBridge(): LightCommandBridge | undefined {
  return window.desktop?.agent?.light;
}

export function showHud(run: LightRun, state: CommandProgressState): void {
  lightBridge()
    ?.show(run.launch.target.id, state)
    .catch((error: unknown) => console.error('The progress HUD did not show:', error));
}

export function hideHud(run: LightRun): Promise<void> {
  return (
    lightBridge()
      ?.hide(run.launch.target.id)
      .catch((error: unknown) => console.error('The progress HUD did not hide:', error)) ??
    Promise.resolve()
  );
}

export function stopRun(taskId: string, runId: string): void {
  agentApi()
    .stop(taskId, runId)
    .catch((error: unknown) => console.error('The cancelled command did not stop:', error));
}

/**
 * Lets the run's task go (`LightCommandBridge.release`). The hold is keyed by the write target, so
 * a run that a newer launch on the same target replaced (`changeLightRun`, or a launch from the
 * same field) leaves it to that run. Letting go twice is harmless.
 */
export function letGo(run: LightRun): void {
  const { current } = lightRuns;
  if (current !== run && current?.launch.target.id === run.launch.target.id) return;
  lightBridge()?.release(run.launch.target.id);
}
