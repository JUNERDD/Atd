import type { CallParams, EventPayload } from '../native-bridge/client';
import type { PreparedCommand } from './agent/bridge';
import type { Screenshot } from './agent/screenshot-input';

/** The capture overlay's two modes: a screenshot, or a recording of the screen. */
export type CaptureMode = Extract<CallParams<'screenshot.capture'>, { purpose: 'capture' }>['mode'];

/**
 * How a capture from the composer or a screenshot/record-screen shortcut ended (`CaptureBridge.capture`):
 * with nothing for the page (`none`: cancelled, or handed over to a recording the shell runs on its
 * own), with a screenshot to attach to the composer (`attach`), with a question about it asked on
 * the screenshot toolbar (`ask`, with the text picked in the screenshot it is about, if any), or
 * with a command picked there, which went to the launch channel (`launched`).
 */
export type CaptureOutcome =
  | { kind: 'none' }
  | { kind: 'attach'; shot: Screenshot }
  | { kind: 'ask'; shot: Screenshot; question: string; selection?: string }
  | { kind: 'launched' };

/** A question the person asked on a screen recording's or a long screenshot's result card. */
export type RecordingAsk = EventPayload<'recording.ask'>;
/** The answer to a result card's question as it stands (`recording.answer`). */
export type RecordingAnswer = CallParams<'recording.answer'>;

/**
 * The recording's and the long screenshot's result cards' questions, which the panel's page runs
 * (`recording-asks.ts`).
 */
export interface RecordingAsksBridge {
  onAsk: (listener: (ask: RecordingAsk) => void) => () => void;
  /** The person stopped the ask `askId`. */
  onStop: (listener: (askId: string) => void) => () => void;
  /** The person opened the ask `askId` in Atd. */
  onOpen: (listener: (askId: string) => void) => () => void;
  answer: (answer: RecordingAnswer) => Promise<void>;
}

/** A command run on text picked in a screenshot, which the screenshot keeps open for. */
export type CaptureTextRun = EventPayload<'captureText.run'>;
/** A press on the result card of such a run (`captureText.action`). */
export type CaptureTextAction = EventPayload<'captureText.action'>;
/** Such a run as its result card shows it (`captureText.progress`). */
export type CaptureTextProgress = CallParams<'captureText.progress'>;

/**
 * The runs on text picked in a screenshot (the capture editor's, or a long screenshot preview's),
 * which the panel's page runs (`capture-text-runs.ts`).
 */
export interface CaptureTextBridge {
  onRun: (listener: (run: CaptureTextRun) => void) => () => void;
  onAction: (listener: (action: CaptureTextAction) => void) => () => void;
  progress: (progress: CaptureTextProgress) => Promise<void>;
  /**
   * The run's command prepared on what the shell sent: its selection holds the paragraphs in the
   * capture grammar's blocks (`formatCaptureSelection`), its files the screenshot and its context,
   * its values the picked ones over the remembered ones, and its output where this run's answer
   * goes. Rejects when the command is gone or turned off, or the text is over the capture limit.
   */
  prepare: (run: CaptureTextRun) => Promise<PreparedCommand>;
}

/**
 * The composer's capture, capture shortcuts and result card questions, owned by the panel's page.
 */
export interface CaptureBridge {
  /**
   * The screenshot or record-screen shortcut (or the mini panel's screenshot) fired, with the mode
   * the capture opens in; returns the unsubscribe. The page takes the capture itself (`capture`).
   */
  onShortcut: (listener: (mode: CaptureMode) => void) => () => void;
  /**
   * Captures in `mode` with the screenshot toolbar and says how the capture ended. A command picked
   * on the toolbar is prepared with the screenshot and launched through the launch channel
   * (`AgentBridge.onLaunch`, marked `fromCapture`) before this resolves. Rejects as
   * `DesktopBridge.captureScreenshotInput` does, and when the picked command is gone.
   */
  capture: (mode: CaptureMode) => Promise<CaptureOutcome>;
  readonly recordingAsks: RecordingAsksBridge;
  readonly captureText: CaptureTextBridge;
}
