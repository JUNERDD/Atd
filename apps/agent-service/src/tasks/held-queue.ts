import type { QueueState, TaskInput } from '@atd/agent-contracts';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { ConflictError } from '../errors.js';
import type { LiveState } from '../live-state.js';
import { withinQueue } from './queue-replace.js';

/**
 * The queue a task keeps out of its Pi session from the start of a lite run (`RunSnapshot.lite`,
 * lite-session.ts) until a full session takes it over. A lite session answers only its command's
 * prompt: it has no tools and a short system prompt, so a message queued into it would be answered
 * without either. While holding:
 *
 * - a follow-up or a steer is kept here as a follow-up (a lite run lasts seconds and has no tools
 *   to steer between), shown as the task's queue and edited as Pi's queue is (`replace`);
 * - Stop withdraws the messages and returns them, as it withdraws Pi's queue (`withdraw`);
 * - as the lite run completes, the runner manager accepts the first message as the task's next
 *   run (`next`), before the lite run is seen to end; a lite run that fails keeps them, as a failed
 *   run's Pi queue stays queued;
 * - the next full session of the task, whichever run opens it, takes the rest as its own
 *   follow-ups, in order, before its prompt (`handOver`), and the holding ends; while one of them
 *   is an extension command, the holding goes on through that run instead (see `handOver`).
 */
export class HeldQueue {
  /** The kept follow-ups; null while the task's queue is its Pi session's. */
  private held: string[] | null = null;

  /** `publish` announces the queue the task shows after a change (`queue.update`). */
  constructor(private readonly publish: (queue: QueueState) => void) {}

  /** A lite run starts: queued messages are kept here from now on. */
  start(): void {
    this.held ??= [];
  }

  isHolding(): boolean {
    return this.held !== null;
  }

  /** The queue the task shows while holding; null when its Pi session's queue is the one. */
  state(): QueueState | null {
    return this.held && { steering: [], followUp: [...this.held] };
  }

  add(text: string): void {
    this.kept().push(text);
    this.announce();
  }

  /**
   * Replaces the kept follow-ups with `followUp`, which may only remove or reorder them, as
   * `replaceFollowUps` refuses to bring back a delivered message.
   */
  replace(followUp: string[]): QueueState {
    const held = this.kept();
    if (!withinQueue(followUp, held))
      throw new ConflictError('The queue changed before this edit. Try again.');
    held.splice(0, held.length, ...followUp);
    this.announce();
    return { steering: [], followUp: [...held] };
  }

  /** Takes every kept message back out, undelivered, for Stop to return; holding goes on. */
  withdraw(): string[] {
    if (!this.held?.length) return [];
    const withdrawn = this.held.splice(0);
    this.announce();
    return withdrawn;
  }

  /** The first kept message, taken out to become the task's next run's prompt. */
  next(): string | undefined {
    const text = this.held?.shift();
    if (text !== undefined) this.announce();
    return text;
  }

  /** Keeps a message `next` took out again, first, when its run could not be accepted. */
  putBack(text: string): void {
    (this.held ??= []).unshift(text);
    this.announce();
  }

  /**
   * Queues the kept messages on a full session as its follow-ups, which Pi delivers after the
   * run's prompt, one at a time, and ends the holding. A message added meanwhile is taken too,
   * after the others; only the queue the session ends with is published.
   *
   * Pi refuses to queue an extension command, and only the full session knows its commands, so a
   * kept one cannot be refused when it is kept, as the live queue refuses it, and queueing it here
   * would fail the run. While one is kept, nothing is handed over (or, for one added meanwhile,
   * nothing from it on) and the holding goes on through this run, so what the user queues
   * meanwhile, a steer included, waits behind them: the kept messages keep starting the task's next
   * runs one at a time, each as the prompt, which Pi never expands (run-prompt.ts), so the command's
   * text reaches the model as written, as if the user had sent it as a message.
   */
  async handOver(live: LiveState): Promise<void> {
    const held = this.held;
    const queueable = (text: string) => !isExtensionCommand(live.session, text);
    if (!held || !held.every(queueable)) return;
    if (held.length)
      await live.transcript.batchQueue(async () => {
        for (let text = held[0]; text !== undefined && queueable(text); text = held[0]) {
          held.shift();
          await live.session.followUp(text);
        }
      });
    if (held.length) this.announce();
    else this.held = null;
  }

  private kept(): string[] {
    if (!this.held) throw new Error('No lite run holds the queue.');
    return this.held;
  }

  private announce(): void {
    const state = this.state();
    if (state) this.publish(state);
  }
}

/**
 * Whether Pi treats `text` as a command an extension of `session` registered, which its `followUp`
 * and `steer` refuse to queue; parsed as Pi's own check parses it (`_throwIfExtensionCommand`).
 */
function isExtensionCommand(session: AgentSession, text: string): boolean {
  if (!text.startsWith('/')) return false;
  const space = text.indexOf(' ');
  const name = space === -1 ? text.slice(1) : text.slice(1, space);
  return session.extensionRunner.getCommand(name) !== undefined;
}

/** The input of a run a kept message starts: plain text, as the user typed it, without chips. */
export function heldMessageInput(text: string): TaskInput {
  return {
    text,
    source: 'manual',
    capturedAt: new Date().toISOString(),
    selection: '',
    clipboard: '',
    files: [],
    arguments: {},
    chips: [],
    folders: [],
  };
}
