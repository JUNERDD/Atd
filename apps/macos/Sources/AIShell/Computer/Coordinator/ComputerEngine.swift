import AICore
import AppKit
import Darwin
import Foundation

/// A failure with its D3 code, from an engine or from the coordinator's own checks. The message
/// is agent-facing English and is cut to the contract's 2000 characters on the wire.
struct ComputerFailure: Error, Equatable, Sendable {
  let code: ComputerErrorCode
  let message: String
  /// Whether the target may have received input before the step failed: a timeout after the
  /// input was sent, a worker that died mid-step. The step's effect is then reported `unknown`
  /// and it is never retried.
  var mayHaveDispatched = false
  /// Which background limit stopped the request: carried on `noBackgroundRoute`, on a refused
  /// `openAccess` (`openBrowser`), and on `targetUnavailable` for a window the host cannot read
  /// (`minimized`, `offSpace`, `fullScreen`); nil for every other failure.
  var reason: ComputerRefusalReason?

  init(
    _ code: ComputerErrorCode, _ message: String, mayHaveDispatched: Bool = false,
    reason: ComputerRefusalReason? = nil
  ) {
    self.code = code
    self.message = message
    self.mayHaveDispatched = mayHaveDispatched
    self.reason = reason
  }

  /// No imperceptible route exists for the step: the host refuses instead of taking the
  /// foreground, and the person does that step themselves (plan I5).
  static func noBackgroundRoute(_ reason: ComputerRefusalReason, _ message: String) -> Self {
    Self(.noBackgroundRoute, message, reason: reason)
  }

  var wire: ComputerErrorWire { ComputerErrorWire(code: code, message: message, reason: reason) }
}

/// What an engine tells the coordinator while a step runs; each event drives the progress the
/// service and the live pointer show, so they follow the real step rather than the model.
enum EngineStepEvent: Sendable {
  /// The step's element was found, at `geometry` when the engine knows it.
  case located(ComputerGeometryWire)
  /// The input is being sent to the target.
  case dispatching(ComputerGeometryWire?)
  /// The engine waits for the target to settle (a `wait` step, a page load).
  case waiting
}

/// The run a `targets` request resolves bindings for. Resolution never asks the person: an
/// application target resolves to its main window, else its focused window, else its front-most
/// one, and the app's other top-level windows are listed as `ownedWindow` surfaces.
struct EngineResolveContext {
  let runId: String
  let unattended: Bool
  let deadline: ContinuousClock.Instant
  var isStopping: () -> Bool = { false }

  func check() throws(ComputerFailure) {
    if Task.isCancelled || isStopping() {
      throw ComputerFailure(.cancelled, "Target resolution was cancelled.")
    }
    if ContinuousClock.now >= deadline {
      throw ComputerFailure(.timeout, "The target resolution deadline passed.")
    }
  }
}

/// A cancellable observation may finish its platform read after its deadline, but must not
/// publish pixels or element tokens the caller can no longer receive.
struct EngineObserveContext {
  let operationId: String
  let deadline: ContinuousClock.Instant
  let isStopping: () -> Bool

  func check() throws(ComputerFailure) {
    if Task.isCancelled || isStopping() {
      throw ComputerFailure(.cancelled, "The observation was cancelled.")
    }
    if ContinuousClock.now >= deadline {
      throw ComputerFailure(.timeout, "The observation deadline passed.")
    }
  }
}

/// The context of one step: who it is for, when it must end, and the coordinator's callbacks.
/// Delivery is always background, and the engine (not the model) picks the route.
struct EngineStepContext {
  let taskId: String
  let runId: String
  let operationId: String
  let actionId: String
  let stepIndex: Int
  /// The surface the action acts on; nil is the target's root surface.
  let surfaceRefId: String?
  /// Unattended runs (automations) never prompt; neither do attended ones while a step runs.
  let unattended: Bool
  var typing = ComputerTypingOptions()
  /// The request's deadline; a step still running then is cancelled by the coordinator.
  let deadline: ContinuousClock.Instant
  /// Whether the coordinator asked the operation to stop (cancel, deadline, quit).
  let isStopping: () -> Bool
  /// When the person last pressed a key, clicked or scrolled (hardware input in any app, as the
  /// disturbance guard reads it); nil when unknown. A route that opens a target-only key scope
  /// must not start within 300 ms of it: the engine waits once, at most 1 s, then refuses
  /// `noBackgroundRoute` with `keyUnavailable` or `textUnavailable` ("the person is typing").
  let lastPersonInput: () -> ContinuousClock.Instant?
  let report: (EngineStepEvent) -> Void
}

/// The driver's account of a step's input, which the disturbance guard merges with its own
/// host-side readings: agent-side facts come from here, while the guard's global monitor only
/// watches the person (plan I8).
struct EngineInputReceipt: Sendable, Equatable {
  /// The route the input took.
  var route: ActionResultWire.Route
  /// Whether a target-only key scope was opened (window-routed pointer, keys, text).
  var keyScopeUsed = false
  /// Whether that scope was handed back; false is a key-focus disturbance by the agent.
  var keyScopeReturned = true
  /// Whether the driver verified that the person's previous key window is key again; nil when no
  /// scope was used or the driver could not tell.
  var personWindowRestored: Bool?
  /// Whether the frontmost app changed while the primitive ran, as the driver read it.
  var frontmostChanged = false
  /// Whether the driver posted repair records (focus or ordering) after the primitive.
  var repaired = false
}

/// How one step ended.
struct EngineStepOutcome: Sendable {
  var outcome: ActionResultFold.StepOutcome
  var evidence: [ComputerEvidenceWire] = []
  /// What the step made stale, such as the observation after a navigation; the host then
  /// requires a new observation before the next action on the target.
  var invalidated: String?
  /// How the input was delivered (always background) and the channel it took, as the engine's
  /// driver reported them; nil when the step sent nothing or the driver did not say.
  var delivery: ComputerDelivery?
  var route: ActionResultWire.Route?
  /// The driver's receipt for the step's input; nil when the step sent none (reads, waits) or the
  /// engine has no per-input receipts (the browser worker).
  var receipt: EngineInputReceipt?
  /// The files the step downloaded (browser targets), already checked to be the run's own.
  var downloads: [ComputerDownloadWire] = []

  init(
    _ outcome: ActionResultFold.StepOutcome, evidence: [ComputerEvidenceWire] = [],
    invalidated: String? = nil, delivery: ComputerDelivery? = nil,
    route: ActionResultWire.Route? = nil, receipt: EngineInputReceipt? = nil
  ) {
    self.outcome = outcome
    self.evidence = evidence
    self.invalidated = invalidated
    self.delivery = delivery
    self.route = route
    self.receipt = receipt
  }
}

/// One computer engine (D13): the browser worker (`playwright`) or the native background driver
/// (`atd`), behind an adapter that owns its process. The coordinator alone decides admission,
/// resources, journal, cancellation, progress and the disturbance guard; an engine only resolves,
/// observes, performs and checks. Every route is imperceptible: an engine never activates or
/// raises an app, moves the pointer, touches the pasteboard or switches Spaces, and never retries
/// a submit. A step with no such route throws `noBackgroundRoute` with a reason instead.
///
/// Every engine method runs on the main actor and may suspend; long work belongs off-main in the
/// engine's own process or actor. A step that cannot be confirmed either way throws with
/// ``ComputerFailure/mayHaveDispatched`` set.
protocol ComputerEngine: AnyObject {
  var id: ComputerEngineID { get }
  /// What the engine can actually do on this Mac, as `computer.hello` publishes it.
  var profile: CapabilityProfileWire { get }
  /// Whether the engine can run: an add-on engine only once its add-on is installed (one that is
  /// not publishes no profile, reports `notInstalled` and is never started); an engine built into
  /// the app always can.
  var isInstalled: Bool { get }
  /// The running generation (bumped on every start); nil while stopped. Target refs of another
  /// generation are stale.
  var generation: Int? { get }

  /// Takes the executables of the current add-on installs; true when this engine's own changed,
  /// so a running engine must stop (its processes run files that moved or are gone).
  func install(_ binaries: EngineBinaries) -> Bool
  /// Starts the engine unless it runs; concurrent callers share one start.
  func start() async throws
  /// Stops the engine and its processes; in-flight calls end (with a failure) once it returns.
  func shutdown() async

  /// Resolves a binding for host generation `generation` to a ref of the engine's running
  /// generation, opening the target in the background when needed.
  func resolve(
    _ binding: TargetBindingWire, generation: Int, context: EngineResolveContext
  ) async throws(ComputerFailure) -> TargetRefWire
  /// Observes the target as `operation` asks (its surface, what to include, a region). A
  /// screenshot captures the target only; the coordinator hides the live pointer around it.
  func observe(
    _ ref: TargetRefWire, _ operation: ObserveOperationWire, context: EngineObserveContext
  )
    async throws(ComputerFailure) -> ObservationWire
  /// Discards host tokens after a read the caller can no longer receive.
  func invalidateObservation(_ ref: TargetRefWire)
  /// Refuses unusable verification conditions before any step can send input.
  func validateConditions(_ action: ComputerActionWire, baseline: ObservationWire)
    async throws(ComputerFailure)
  /// Performs one step whose element refs come from `observation`.
  func perform(
    _ step: ComputerStepWire, on ref: TargetRefWire, observation: ObservationRefWire,
    context: EngineStepContext
  ) async throws(ComputerFailure) -> EngineStepOutcome
  /// Checks a condition; `baseline` is the observation the action started from (`newText`).
  func check(
    _ condition: ComputerConditionWire, on ref: TargetRefWire, baseline: ObservationWire?
  ) async throws(ComputerFailure) -> Bool
  /// Asks the engine to end the step it runs for `operationId` as soon as it safely can.
  func cancel(operationId: String) async
  /// The device resources acting on `ref` touches (its page or its process).
  func resources(for ref: TargetRefWire) -> Set<DeviceResource>
  /// The process a person would use to interact with `ref` (the browser of a managed profile,
  /// the app of a native target).
  func foregroundProcess(of ref: TargetRefWire) -> pid_t?
  /// Whether the person is using `ref` right now, so the host yields (`targetInUse`) instead of
  /// acting under their hands.
  func isInUse(_ ref: TargetRefWire) async -> Bool
  /// Undoes the engine's per-target preparation (occlusion keep-alive; web accessibility stays
  /// on) when the run releases `ref`, the run ends, its binding is deleted or the host quits.
  /// The host calls it once no live run uses `ref`, also for a ref that went stale meanwhile;
  /// another ref resolved for the same window may still need that preparation, which stays.
  func releaseTarget(_ ref: TargetRefWire) async
  /// Stops using `route` for `kind` steps on the app behind `ref` for the rest of the engine's
  /// generation, after the guard attributed a disturbance to it. The engine keys the demotion by
  /// what decides the app's behavior (bundle id, version, toolkit), not by the ref alone.
  func demote(_ route: ActionResultWire.Route, for kind: ComputerStepKind, on ref: TargetRefWire)
  /// The processes that post the engine's input events, so the host's input monitor never
  /// mistakes them for the person's.
  var inputProcesses: Set<pid_t> { get }
}

extension ComputerEngine {
  func validateConditions(_ action: ComputerActionWire, baseline: ObservationWire)
    async throws(ComputerFailure)
  {}

  func foregroundProcess(of ref: TargetRefWire) -> pid_t? {
    ref.native.map { pid_t($0.pid) }
  }

  /// By default the person uses the target while its process is the frontmost app.
  func isInUse(_ ref: TargetRefWire) async -> Bool {
    guard let pid = foregroundProcess(of: ref) else { return false }
    return NSWorkspace.shared.frontmostApplication?.processIdentifier == pid
  }

  func releaseTarget(_ ref: TargetRefWire) async {}

  func demote(
    _ route: ActionResultWire.Route, for kind: ComputerStepKind, on ref: TargetRefWire
  ) {}

  var inputProcesses: Set<pid_t> { [] }
}
