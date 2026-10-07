import { isCorrection } from './cues.js';

/** What started a memory review; the store records it in the origin of what the review learned. */
export type LearnerTrigger = 'correction' | 'cadence' | 'compaction' | 'idle' | 'shutdown';

/** A review to run: its trigger and, for a correction, the user's message. */
export interface LearnerRequest {
  trigger: LearnerTrigger;
  correction?: string;
}

/** Assistant turns after a correction review during which another correction starts none. */
export const CORRECTION_COOLDOWN_TURNS = 3;
/** A long task is reviewed after this many assistant turns since the last review… */
export const CADENCE_TURNS = 10;
/** …or after this many tool calls, whichever comes first. */
export const CADENCE_TOOL_CALLS = 15;
/** User messages a session needs before cadence reviews start. */
export const CADENCE_MIN_USER_MESSAGES = 2;
/** New user messages since the last review that make an idle or closing session worth one. */
export const IDLE_MIN_USER_MESSAGES = 2;

/**
 * When a root session's conversation is worth a memory review (decision R5): a correction, at
 * most once per `CORRECTION_COOLDOWN_TURNS` turns; a cadence in long tasks; before a compaction
 * when a user message is new; and when the session goes idle or closes with
 * `IDLE_MIN_USER_MESSAGES` new user messages. It counts only what learning reads, user messages
 * and turns outside command runs; the caller leaves command runs out. Any review reads the whole
 * recent conversation, so the counts since the last review restart when any review starts.
 */
export class LearnerTriggers {
  private userMessages = 0;
  private userSinceReview = 0;
  private turnsSinceReview = 0;
  private toolCallsSinceReview = 0;
  private turnsSinceCorrection = CORRECTION_COOLDOWN_TURNS;
  private correction: string | null = null;

  /** A user message learning may read. A correction waits for the end of the turn it starts. */
  userMessage(text: string): void {
    this.userMessages += 1;
    this.userSinceReview += 1;
    if (isCorrection(text)) this.correction = text;
  }

  /**
   * An assistant turn ended after `toolCalls` tool calls. Answers the review it makes due: the
   * pending correction outside the cooldown, otherwise the cadence. A correction inside the
   * cooldown starts nothing; the conversation still holds it for the next review.
   */
  turnEnded(toolCalls: number): LearnerRequest | null {
    this.turnsSinceReview += 1;
    this.toolCallsSinceReview += toolCalls;
    const correction = this.correction;
    this.correction = null;
    if (correction !== null && this.turnsSinceCorrection >= CORRECTION_COOLDOWN_TURNS) {
      this.turnsSinceCorrection = 0;
      return { trigger: 'correction', correction };
    }
    this.turnsSinceCorrection += 1;
    const cadence =
      this.turnsSinceReview >= CADENCE_TURNS || this.toolCallsSinceReview >= CADENCE_TOOL_CALLS;
    return cadence && this.userMessages >= CADENCE_MIN_USER_MESSAGES
      ? { trigger: 'cadence' }
      : null;
  }

  /** Whether a compaction is worth a review: a user message came after the last one. */
  compactionDue(): boolean {
    return this.userSinceReview > 0;
  }

  /** Whether an idle or closing session is worth a review. */
  idleDue(): boolean {
    return this.userSinceReview >= IDLE_MIN_USER_MESSAGES;
  }

  /** A review started; it reads everything said so far. */
  reviewed(): void {
    this.userSinceReview = 0;
    this.turnsSinceReview = 0;
    this.toolCallsSinceReview = 0;
  }
}
