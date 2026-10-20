import type {
  ComputerPrepareResult,
  ComputerProgress,
  ComputerResolveFactsRequest,
  ComputerResolveFactsResponse,
  ComputerStatusResponse,
  DeleteComputerBindingResponse,
  StopAllComputerResponse,
} from '@atd/agent-contracts';
import type { CallResult, EventPayload } from '../native-bridge/client';

export type ComputerPreviewSource = EventPayload<'computer.state'>['previews'][number];

/** An engine of the shell's computer host as `computer.state` reports it. */
export interface ComputerEngineState {
  engine: 'playwright' | 'atd';
  state: 'starting' | 'ready' | 'unqualified' | 'unavailable' | 'notInstalled';
  /** Runtime text for the person; not translated. */
  detail: string;
}

/**
 * Screen capture prepared for this app build (`computer.primeCaptureConsent`): the bundle id it
 * was recorded for, this app's own, and when the capture succeeded (ISO 8601).
 */
export interface ComputerCaptureConsent {
  bundleId: string;
  primedAt: string;
}

/** What preparing screen capture answered (`computer.primeCaptureConsent`). */
export type ComputerCaptureConsentResult = CallResult<'computer.primeCaptureConsent'>;

/**
 * The shell's computer host (`computer.state`): `ready` when this app holds the host lock and the
 * service bound it, `locked` when another Atd holds the lock, `starting`, or `unavailable` without
 * a service connection; whether the live pointer shows; each engine's readiness; the actions
 * whose effect nobody could confirm, which pause background computer use until a person checked
 * the affected apps and sites (ids only, at most 50 of `count`); whether screen capture was
 * prepared for this build (null until it was); and whether macOS lets the app post input to
 * other apps, a grant System Settings lists under Accessibility.
 */
export interface ComputerShellState {
  host: 'starting' | 'ready' | 'locked' | 'unavailable';
  pointerVisible: boolean;
  typing: boolean;
  typingAnimation: boolean;
  engines: ComputerEngineState[];
  unsettled: { count: number; actionIds: string[] };
  previews: ComputerPreviewSource[];
  captureConsent: ComputerCaptureConsent | null;
  postEventAccess: boolean;
}

/** What adding a browser environment asks the shell to prepare (`computer.prepareBrowser`). */
export interface ComputerBrowserRequest {
  label: string;
  startUrl: string;
  /** `scheme://host[:port]` origins the environment may reach. */
  allowedOrigins: string[];
}

/**
 * What adding an application asks the shell to prepare (`computer.prepareApplication`): the app
 * the person picked, which the shell locates and checks itself.
 */
export interface ComputerApplicationRequest {
  label: string;
  bundleId: string;
}

/**
 * Browser and computer use. The service lists the registered targets, stops work and records
 * that a person checked an action; the shell prepares targets, reopens a browser environment for
 * signing in again, shows the live pointer and prepares screen capture when the person asks.
 * Neither path lets the page write a target's content: the shell registers what it prepared.
 */
export interface ComputerBridge {
  /** A small system app icon as a PNG data URL, or null when its installed artwork is unavailable. */
  applicationIcon(bundleId: string): Promise<string | null>;
  /** Installed app metadata for mentions; available without computer engines or target access. */
  listApplications(): Promise<{ bundleId: string; name: string }[]>;
  /** The service's view: host state, registered targets and the targets runs are using. */
  status(): Promise<ComputerStatusResponse>;
  /** Disconnects a target; the automations authorized for it need authorizing again. */
  removeBinding(bindingId: string): Promise<DeleteComputerBindingResponse>;
  /** Stops the computer work of every run. */
  stopAll(): Promise<StopAllComputerResponse>;
  /** The latest progress of each run of a task, for a view that opens or reconnects. */
  progress(taskId: string): Promise<ComputerProgress[]>;
  /** Live progress frames as the stream delivers them, unfiltered. */
  onProgress(listener: (progress: ComputerProgress) => void): () => void;
  /** The shell's host state; the latest one is replayed to a new listener. */
  onState(listener: (state: ComputerShellState) => void): () => void;
  /** Shows authorized sources in an independent native window, without transferring pixels. */
  showPreview(taskId: string): Promise<CallResult<'computer.preview.show'>>;
  /** Targets may have changed: the host state moved, a target was prepared, or a reconnect. */
  onChange(listener: () => void): () => void;
  /** Creates a managed browser environment, opens it for signing in and registers it. */
  prepareBrowser(request: ComputerBrowserRequest): Promise<ComputerPrepareResult>;
  /** Registers an application as a target; a success carries the shell's read-only probe. */
  prepareApplication(request: ComputerApplicationRequest): Promise<ComputerPrepareResult>;
  /**
   * The task's actions that still await a person's check (`GET /v1/computer/facts/unresolved`),
   * across all of its runs; the ones `resolveFacts` can still settle.
   */
  unresolvedFacts(taskId: string): Promise<string[]>;
  /**
   * The person checked what these actions of the task did (`POST /v1/computer/facts/resolve`);
   * answers the ones that were still unresolved.
   */
  resolveFacts(request: ComputerResolveFactsRequest): Promise<ComputerResolveFactsResponse>;
  /**
   * Prepares screen capture for this app build, so macOS asks for its consent now rather than
   * during a run; only Settings calls it, when the person asks. A success also reaches `onState`.
   */
  primeCaptureConsent(): Promise<ComputerCaptureConsentResult>;
  /** The person checked what these unconfirmed actions may have changed; the host settles them. */
  acknowledgeUnsettled(actionIds: string[]): Promise<void>;
  /**
   * Opens a browser environment in front when the person asks: to sign in again, or when a run
   * could not start its browser in the background.
   */
  openProfile(bindingId: string): Promise<void>;
  /** Shows or hides the live pointer that follows computer actions. */
  setPointerVisible(visible: boolean): Promise<void>;
  /** Local input effects, independent of the Commands preferences. */
  setTyping(setting: 'typing' | 'animation', enabled: boolean): Promise<void>;
  /** The shell's application picker; empty when cancelled. */
  pickApp(): Promise<{ bundleId: string; name: string } | null>;
}
