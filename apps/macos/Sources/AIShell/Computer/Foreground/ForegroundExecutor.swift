import AICore
import AppKit
import Carbon.HIToolbox

/// Does one step in the foreground once every background route refused it
/// (docs/plans/2026-10-21-foreground-fallback.md, R4–R6, R13), in this order:
/// 1. waits until the person has left every input alone for ``ForegroundPolicy/quiet`` and holds
///    nothing down, or refuses `inputInUse` with nothing sent;
/// 2. adds global input to the action's claim, so one foreground step runs at a time;
/// 3. shows a hidden target, brings it and the step's window to the front and checks it: the app
///    frontmost, the step's window holding its focus, every point hit-testing to that exact window
///    (Atd's own panel counts); a check that fails refuses `notActivated` or `covered`, or asks
///    for a new observation when a point is off its window, with nothing sent;
/// 4. sends the input piece by piece (``ForegroundPlan/send``), posted to the target's process as
///    the background posts it, so no piece moves the person's pointer or passes through the HID
///    system; before each piece it stops at the person's first input since the step began, and
///    checks again that the target is in front with the step's window focused;
/// 5. puts back what the person had in front when the act step began, only while the target is
///    still in front (``ForegroundScene``), on every way out, at once when it did not finish;
/// 6. reports `foreground` delivery with a sentence of what it did and put back. The action's
///    postcondition, if any, is checked after this, so after the restore.
struct ForegroundExecutor {
  /// Who the step is for and how it ends.
  struct Context {
    /// The action's claim owner, which adds global input to the target claim it holds.
    let owner: ClaimOwner
    /// What the person had in front when the act step began, before its background attempt:
    /// what the step puts back.
    let before: DisturbanceSnapshot
    let deadline: ContinuousClock.Instant
    let isStopping: () -> Bool
    let report: (EngineStepEvent) -> Void
    let phases: OperationPhases
    let diagnostics = ForegroundDiagnostics()
  }

  /// What a step sent so far.
  struct Sent {
    /// Whether any piece went out, which the target may have acted on.
    var any = false
    /// The keyboard pieces sent, which the target takes in before the person's app comes back.
    var keys = 0
    /// Whether the latest piece may have moved the keyboard focus, so keys wait for it to settle.
    var focusMoved = false
  }

  /// The least time a step needs before its deadline to come forward, act and go back.
  static let leastTime: Duration = .seconds(2)
  /// The longest the step waits for global input once the person paused.
  static let claimWait: Duration = .seconds(3)
  /// How long the window order gets to settle once the app is in front.
  static let settleLimit: Duration = .milliseconds(400)
  /// How long the target gets to take in a step that went through before the person's app comes
  /// back: a base, plus a little per keyboard piece, up to a limit.
  static let drainBase: Duration = .milliseconds(120)
  static let drainLimit: Duration = .milliseconds(1200)

  let arbiter: DeviceArbiter
  let disturbance: DisturbanceGuard

  func run(_ plan: ForegroundPlan, context: Context, record: ForegroundRecord)
    async throws(ComputerFailure) -> EngineStepOutcome
  {
    let started = ContinuousClock.now
    defer { context.phases.add(.foreground, since: started) }
    guard context.deadline - .now > Self.leastTime else {
      throw ComputerFailure(
        .timeout, "Too little time was left to do this step in the foreground; nothing was sent.")
    }
    try await awaitQuiet(context)
    let claim = try await claimInput(context)
    defer { claim.release() }
    // The person may have started again while the claim waited. From here on, any input of
    // theirs stops the step (R5).
    try await awaitQuiet(context)
    let watched = ContinuousClock.now
    if let block = ComputerScreenState.writeBlock() { throw block }
    guard let app = NSRunningApplication(processIdentifier: plan.pid), !app.isTerminated else {
      throw ComputerFailure(.targetChanged, "The target app quit; list targets again.")
    }
    let name = app.localizedName ?? app.bundleIdentifier ?? "the target app"
    if plan.composes, let method = Self.inputMethod { throw Self.composing(plan, method, name) }
    let target: Set<pid_t> = [plan.pid]
    let scene = ForegroundScene(context.before)
    let order = await ForegroundActivation.order(of: plan.pid)
    var shown: NSRunningApplication?
    var sent = Sent()
    var failure: ComputerFailure?
    do throws(ComputerFailure) {
      if app.isHidden {
        shown = app
        try await show(app, plan, name: name, context)
      }
      try await bringForward(plan, app: app, name: name, since: watched, context)
      context.report(.dispatching(plan.geometry))
      try await send(plan, name: name, since: watched, sent: &sent, context)
    } catch {
      failure = error
    }
    // Only a step that went through gets time to land; after the person's input, a stop or any
    // other failure their screen comes back at once.
    if failure == nil, sent.any { await drain(sent, pid: plan.pid) }
    var restoration = await scene.restore(target: target, shown: shown)
    restoration.personTyped = disturbance.personTyped(since: watched)
    let moved = order.moved(plan.windowId, to: await ForegroundActivation.order(of: plan.pid))
    record.receipt = EngineInputReceipt(route: .events, foreground: restoration)
    context.phases.note("foreground", failure.map(\.code.rawValue) ?? "done")
    context.phases.note("restored", restoration.front.rawValue)
    let apps = ForegroundEvidence.Apps(
      target: name, previous: scene.frontName(besides: target),
      now: NSWorkspace.shared.frontmostApplication.flatMap { front in
        target.contains(front.processIdentifier) ? nil : front.localizedName
      })
    if let failure {
      context.diagnostics.failed(failure, plan: plan, owner: context.owner, sent: sent.any)
      throw Self.ended(failure, ForegroundEvidence.restoreNote(restoration, apps: apps), sent.any)
    }
    context.diagnostics.completed(owner: context.owner)
    let sentence = ForegroundEvidence.sentence(
      did: plan.gestures, apps: apps, restoration: restoration, orderChanged: moved)
    return EngineStepOutcome(
      sent.any ? .dispatched : .notDispatched,
      evidence: [ComputerEvidenceWire(kind: .text, summary: sentence)], delivery: .foreground,
      route: .events, receipt: record.receipt)
  }

  // MARK: Before the input

  /// Shows a target the person hid (⌘H), for the step; refuses `notActivated`, with nothing sent,
  /// when its window does not come on screen. The restore hides it again.
  private func show(
    _ app: NSRunningApplication, _ plan: ForegroundPlan, name: String, _ context: Context
  ) async throws(ComputerFailure) {
    guard await ForegroundActivation.show(app, windowId: plan.windowId, before: context.deadline)
    else {
      throw .noBackgroundRoute(
        .notActivated,
        "\(name) is hidden, and Atd could not show its window for this step; nothing was sent.")
    }
  }

  /// R4.4: the step's window made its app's main one, the app activated, the window raised again,
  /// then the checks, given ``settleLimit`` to come true as the window server reorders.
  private func bringForward(
    _ plan: ForegroundPlan, app: NSRunningApplication, name: String,
    since start: ContinuousClock.Instant, _ context: Context
  ) async throws(ComputerFailure) {
    _ = await ForegroundActivation.raise(
      pid: plan.pid, windowId: plan.windowId, diagnostics: context.diagnostics,
      stage: "beforeActivation")
    guard await ForegroundActivation.activate(app, before: context.deadline) else {
      // The person's input first: it may be what kept the target back.
      try check(since: start, sent: false, context)
      throw .noBackgroundRoute(
        .notActivated, "Atd could not bring \(name) to the front for this step; nothing was sent.")
    }
    _ = await ForegroundActivation.raise(
      pid: plan.pid, windowId: plan.windowId, diagnostics: context.diagnostics,
      stage: "afterActivation")
    let end = min(.now + Self.settleLimit, context.deadline)
    while let problem = await readiness(
      plan, plan.gestures, name: name, diagnostics: context.diagnostics, stage: "bringForward")
    {
      try check(since: start, sent: false, context)
      guard ContinuousClock.now < end else { throw problem }
      try? await Task.sleep(for: .milliseconds(30))
    }
    // The person's own app may set another input source for itself than the target does.
    if plan.composes, let method = Self.inputMethod { throw Self.composing(plan, method, name) }
    try check(since: start, sent: false, context)
  }

  /// Why the target is not ready for `gestures` yet; nil once it is: the app frontmost, the step's
  /// window on screen and holding its focus, and every point hit-testing to that exact window.
  /// Each refuses as if nothing was sent; the caller says otherwise once
  /// something was.
  func readiness(
    _ plan: ForegroundPlan, _ gestures: [ForegroundGesture], name: String,
    diagnostics: ForegroundDiagnostics, stage: String
  ) async -> ComputerFailure? {
    diagnostics.checking(stage)
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == plan.pid else {
      return .noBackgroundRoute(
        .notActivated, "\(name) did not stay in front for this step; nothing was sent.")
    }
    // On screen is on a Space the person sees: activation must not have switched Spaces.
    guard ForegroundActivation.isOnScreen(plan.windowId) else {
      return .noBackgroundRoute(
        .notActivated, "The step's window in \(name) is not on screen; nothing was sent.")
    }
    guard await ForegroundActivation.hasKeyFocus(pid: plan.pid, windowId: plan.windowId) else {
      return .noBackgroundRoute(
        .notActivated,
        "The step's window in \(name) did not take the app's focus; nothing was sent.")
    }
    for gesture in gestures {
      for point in gesture.points {
        switch ForegroundActivation.hit(
          point, windowId: plan.windowId, pid: plan.pid, diagnostics: diagnostics)
        {
        case .reaches: continue
        case .covered:
          return .noBackgroundRoute(
            .covered,
            "macOS did not confirm that this point receives mouse input in the step's exact "
              + "window in \(name); nothing was sent.")
        case .offWindow:
          if case .drag = gesture {
            return .noBackgroundRoute(
              .dragAndDrop,
              "This drag leaves the step's window in \(name), and Atd drags only within one "
                + "window; nothing was sent.")
          }
          return ComputerFailure(
            .staleObservation,
            "Where this step acts is no longer on its window in \(name), which moved or changed; "
              + "nothing was sent. Observe the target again.")
        }
      }
    }
    return nil
  }

  /// The refusal of typed keys while an input method is the keyboard input source: it would turn
  /// them into text of its own. It keeps the background's code and reason, and says so.
  private static func composing(_ plan: ForegroundPlan, _ method: String, _ name: String)
    -> ComputerFailure
  {
    ComputerFailure(
      plan.refusal.code,
      "The keyboard input source is an input method (\(method)), which would turn the typed keys "
        + "into text of its own, so Atd did not type in \(name). Nothing was sent. With a "
        + "keyboard layout such as ABC selected Atd can type it; otherwise the person can.",
      reason: plan.refusal.reason)
  }

  /// The name of the keyboard input source in use when it is an input method rather than a plain
  /// layout; nil for a layout. TIS wants the main thread.
  static var inputMethod: String? {
    guard let source = TISCopyCurrentKeyboardInputSource()?.takeRetainedValue(),
      let type = TISGetInputSourceProperty(source, kTISPropertyInputSourceType),
      Unmanaged<CFString>.fromOpaque(type).takeUnretainedValue() as String
        != kTISTypeKeyboardLayout as String
    else { return nil }
    return TISGetInputSourceProperty(source, kTISPropertyLocalizedName).map {
      Unmanaged<CFString>.fromOpaque($0).takeUnretainedValue() as String
    } ?? "an input method"
  }
}
