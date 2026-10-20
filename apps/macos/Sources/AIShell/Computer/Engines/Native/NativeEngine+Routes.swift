import AIComputerDriverKit
import AICore
import Foundation

/// Climbing a step's ladder (``NativeRoutePlan``, plan §4.2). Before any rung the window's
/// placement is read: a write to a minimized window is refused, since Atd never restores a
/// window; on another Space or in a full-screen Space only the accessibility rungs run, which
/// change neither the person's Space nor their front app (D-LADDER-3, probe S10), and the event
/// rungs are refused there. The disturbance guard still wraps every write, so an app that
/// switches Spaces on an accessibility action is caught and its route demoted. A rung that opens
/// a key scope waits for the typing guard. The next rung is tried only when the driver says the
/// previous one sent nothing; a rung that may have acted stops the step, never replayed.
extension NativeEngine {
  /// What a delivered rung reports: its route and the driver's receipts, newest last.
  struct Delivered {
    let rung: NativeRung
    var receipts: [DriverReceipt]

    var route: ActionResultWire.Route { rung.route.wire }
    var receipt: EngineInputReceipt { NativeEngine.receipt(receipts, route: rung.route) }
    /// Whether the driver sent anything (false only when every primitive was a no-op).
    var dispatched: Bool { receipts.contains(where: \.dispatched) }
  }

  /// The route facts of a write of `kind` to `place`, with where its window sits now; a
  /// minimized window is refused.
  func writeFacts(
    _ ref: TargetRefWire, place: NativeSurfaceRead, kind: ComputerStepKind,
    context: EngineStepContext
  ) async throws(ComputerFailure) -> NativeRouteFacts {
    let probe = try await probe(place, operation: context.operationId)
    let placement = probe.placement
    if placement.minimized {
      throw .noBackgroundRoute(
        .minimized, "The window is minimized; Atd never restores a window. Nothing was sent.")
    }
    targets[ref.id]?.toolkit = probe.toolkit
    var facts = routeFacts(for: targets[ref.id]?.app, toolkit: probe.toolkit, kind: kind)
    facts.placement = NativeWindowPlacement(
      onActiveSpace: placement.onActiveSpace, fullScreen: placement.fullScreen)
    return facts
  }

  /// Sends the first rung of `ladder` the driver delivers.
  func climb(
    _ ladder: NativeLadder, kind: ComputerStepKind, place: NativeSurfaceRead,
    ref: TargetRefWire, context: EngineStepContext
  ) async throws(ComputerFailure) -> Delivered {
    var refused: DriverFailure?
    rungs: for rung in ladder.rungs {
      var delivered = Delivered(rung: rung, receipts: [])
      var committed = false
      for primitive in rung.primitives {
        let outcome = try await deliver(
          primitive, kind: kind, place: place, ref: ref, context: context,
          committed: committed)
        switch outcome {
        case .success(let receipt):
          delivered.receipts.append(receipt)
          if receipt.dispatched, !primitive.isPreparation { committed = true }
        case .failure(let refusal):
          refused = refusal
          continue rungs
        }
      }
      return delivered
    }
    throw refusal(ladder, kind: kind, last: refused)
  }

  /// Sends one primitive; a refusal the next rung may follow comes back as a failure, anything
  /// else that stops the step is thrown. `committed` says an earlier primitive of the rung acted.
  func deliver(
    _ primitive: DriverPrimitive, kind: ComputerStepKind, place: NativeSurfaceRead,
    ref: TargetRefWire, context: EngineStepContext, committed: Bool
  ) async throws(ComputerFailure) -> Result<DriverReceipt, DriverFailure> {
    let scoped = NativeRoutePolicy.opensKeyScope(primitive.route)
    var waited = false
    while true {
      if scoped { waited = try await typingGuard(kind, context: context) || waited }
      try dispatchable(context)
      let remaining = context.deadline - .now
      guard remaining > .milliseconds(300) else {
        throw ComputerFailure(
          .timeout, "The step's deadline passed before it was sent.", mayHaveDispatched: committed)
      }
      let budget = min(remaining - .milliseconds(200), .seconds(8))
      let request = DriverPerformRequest(
        target: place.driverTarget, primitive: primitive, routeAllow: [primitive.route],
        deadlineMilliseconds: budget / .milliseconds(1),
        userTypedWithinGuard: NativeTypingGuard.wait(
          lastInput: context.lastPersonInput(), now: .now) != nil)
      targets[ref.id]?.acted = true
      let result = await self.request(
        .perform(request), timeout: budget + Self.performGrace, operation: context.operationId)
      switch result {
      case .success(.perform(let performed)):
        return .success(performed.receipt)
      case .success:
        throw ComputerFailure(
          .engineFailed, "The driver answered a perform unexpectedly.", mayHaveDispatched: true)
      case .failure(.refused(let refusal)) where refusal.code == .userTyping && !waited:
        waited = true
        continue
      case .failure(.refused(let refusal)):
        if !committed, NativeDriverFailureMap.degrades(refusal) { return .failure(refusal) }
        let mapped = NativeDriverFailureMap.perform(refusal, step: kind)
        let message =
          refusal.code == .userTyping
          ? NativeTypingGuard.message
          : "The driver refused the \(kind.rawValue) step: \(refusal.message ?? refusal.code.rawValue)"
        throw ComputerFailure(
          mapped.code, message, mayHaveDispatched: mapped.mayHaveDispatched || committed,
          reason: mapped.reason)
      case .failure(let failure):
        var thrown = self.failure(failure, kind: "\(kind.rawValue) step", writes: true)
        thrown.mayHaveDispatched = thrown.mayHaveDispatched || committed
        throw thrown
      }
    }
  }

  /// Waits once, at most a second, while the person types; refuses when they still do. Returns
  /// whether it waited.
  func typingGuard(_ kind: ComputerStepKind, context: EngineStepContext)
    async throws(ComputerFailure) -> Bool
  {
    guard let wait = NativeTypingGuard.wait(lastInput: context.lastPersonInput(), now: .now)
    else { return false }
    do { try await Task.sleep(for: wait) } catch {
      throw ComputerFailure(.cancelled, "The step was cancelled.")
    }
    try dispatchable(context)
    if NativeTypingGuard.wait(lastInput: context.lastPersonInput(), now: .now) != nil {
      throw .noBackgroundRoute(NativeTypingGuard.reason(for: kind), NativeTypingGuard.message)
    }
    return true
  }

  /// The refusal when no rung delivered, with the reason ``NativeLadder/refusal(after:)`` picks
  /// (plan §4.2 table).
  private func refusal(_ ladder: NativeLadder, kind: ComputerStepKind, last: DriverFailure?)
    -> ComputerFailure
  {
    var notes: [String] = []
    let reason = ladder.refusal(
      after: last.flatMap { NativeDriverFailureMap.perform($0, step: kind).reason })
    if let last {
      notes.append("the driver refused the last route (\(last.message ?? last.code.rawValue))")
    }
    for (route, exclusion) in ladder.excluded.sorted(by: { $0.key.rawValue < $1.key.rawValue }) {
      notes.append("\(route.rawValue) is off (\(Self.describe(exclusion, ladder.placement)))")
    }
    if notes.isEmpty { notes.append("the element offers no action or settable value for it") }
    return .noBackgroundRoute(
      reason,
      "No background route for this \(kind.rawValue) step: \(notes.joined(separator: "; ")). "
        + "Nothing was sent; the person can do this step.")
  }

  private static func describe(
    _ exclusion: NativeRouteExclusion, _ placement: NativeWindowPlacement
  )
    -> String
  {
    switch exclusion {
    case .placement:
      placement == .fullScreen
        ? "the window is in a full-screen Space, where Atd uses accessibility actions only"
        : "the window is on another Space, where Atd uses accessibility actions only"
    case .disabled: "this kind of window-routed input is off in this version of Atd"
    case .toolkit: "this app's toolkit takes no such input in the background"
    case .capability: "the driver cannot do it on this Mac"
    case .permission: "Atd is not allowed to send input events to apps"
    case .demoted: "it disturbed the person earlier and stays off for this app until Atd restarts"
    }
  }

  /// The driver's receipts of one step as the disturbance guard reads them. The driver reports a
  /// key scope with nothing to hand back (the person had no key window) as returned, with no
  /// restoration to check; a scope whose return failed still counts as returned when the
  /// person's window was read as key again.
  static func receipt(_ receipts: [DriverReceipt], route: DriverRoute) -> EngineInputReceipt {
    var receipt = EngineInputReceipt(route: route.wire)
    for driver in receipts {
      if let scope = driver.keyScope, scope.used {
        receipt.keyScopeUsed = true
        receipt.repaired = true
        receipt.keyScopeReturned =
          receipt.keyScopeReturned && (scope.returned || scope.userWindowRestored == true)
        if let restored = scope.userWindowRestored {
          receipt.personWindowRestored = (receipt.personWindowRestored ?? true) && restored
        }
      }
      if let front = driver.frontmost {
        let before = front.frontmostPidBefore
        let after = front.frontmostPidAfter
        let moved = before != nil && after != nil && before != after
        if front.targetRaised || moved { receipt.frontmostChanged = true }
      }
    }
    return receipt
  }

  /// The last check before input goes out.
  func dispatchable(_ context: EngineStepContext) throws(ComputerFailure) {
    if context.isStopping() || stopping.contains(context.operationId) || Task.isCancelled {
      throw ComputerFailure(.cancelled, "The operation was cancelled.")
    }
  }
}
