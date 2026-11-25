import type { PermissionAnswer } from '@atd/agent-contracts';
import type { HudRequest, RunStatus, RunView } from '../../channel/payloads.ts';
import type { FollowUpState } from './local.ts';

/** What a HUD control asks for; the HUD controller turns it into a message to the background. */
export type HudIntent =
  | { kind: 'takeOver' }
  | { kind: 'handBack' }
  | { kind: 'stop' }
  | { kind: 'open' }
  | { kind: 'saveAutomation' }
  | { kind: 'dismiss' }
  | { kind: 'copy'; text: string }
  | { kind: 'answer'; request: HudRequest; answer: PermissionAnswer };

/** Everything one run state renders from: the shell's run plus this tab's local overlays. */
export interface RunRender {
  run: RunView;
  /** The status shown: the shell's, or `stopping` right after the person pressed Stop. */
  status: RunStatus;
  /** Whether Atd can be reached to open it (the channel answers). */
  reachable: boolean;
  /** Whether Atd and its service answer: only then can a follow-up be sent. */
  ready: boolean;
  /** Glow effects on: the working step shimmers. */
  effects: boolean;
  /** Stopping for 400 ms or more: the mark becomes a spinner. */
  late: boolean;
  /** Save as automation for this run: sent ("Sent to Atd"), or it failed and may be retried. */
  followUp: FollowUpState;
  /** An answer to the shown request is on its way; its buttons wait for the next state. */
  answering: boolean;
  /** The page covered the card when the person answered: they are pointed to Atd instead. */
  covered: boolean;
  /** The run's reply was just copied. */
  copied: boolean;
  intent(intent: HudIntent): void;
}
