import AIComputerDriverKit
import AICore
import Foundation

/// Performing one native step on the surface the action names. Every step but `wait` first lists
/// the target's surfaces again and is refused `modalBlocked` while a modal surface covers the one
/// it writes to, then reads where its window sits (a minimized one is refused; on another Space
/// or in a full-screen Space only the accessibility rungs run) and climbs its route ladder;
/// nothing is ever escalated to the foreground. A driver's receipt never makes a step verified; only a read-back
/// does.
extension NativeEngine {
  /// How often `wait` checks its condition.
  static let waitInterval: Duration = .milliseconds(250)

  func perform(
    _ step: ComputerStepWire, on ref: TargetRefWire, observation: ObservationRefWire,
    context: EngineStepContext
  ) async throws(ComputerFailure) -> EngineStepOutcome {
    defer { stopping.remove(context.operationId) }
    try Self.requireUnlockedSession()
    _ = try window(of: ref)
    guard let target = targets[ref.id], let current = target.observation,
      current.id == observation.id
    else {
      throw ComputerFailure(
        .staleObservation, "The observation is no longer current; observe the target again.")
    }
    let named = context.surfaceRefId == target.surfaces.root.id ? nil : context.surfaceRefId
    guard named == target.observed?.surfaceRefId else {
      throw ComputerFailure(
        .staleObservation,
        "The observation is of another surface; observe the surface the action acts on.")
    }
    if case .wait(let condition, let timeoutMs) = step {
      return try await wait(
        condition, timeoutMs: timeoutMs, ref: ref, baseline: current, context: context)
    }
    try requireAccessibility()
    var laps = context.phases.laps()
    try await requireUnblocked(ref, surface: named)
    laps.end(.surfaces)
    let place = try observedRead(ref)
    let facts = try await writeFacts(ref, place: place, kind: step.kind, context: context)
    laps.end(.probe)
    let write = Write(ref: ref, observation: current, place: place, facts: facts, context: context)
    switch step {
    case .setValue(let locator, let text):
      return try await setValue(locator, text, write)
    case .clear(let locator):
      return try await clear(locator, write)
    case .press(let locator, let effect):
      return try await press(locator, effect: effect, write)
    case .click, .key, .type, .menu, .scroll, .drag:
      return try await input(step, write)
    case .navigate, .fill, .wait, .select, .upload:
      throw ComputerFailure(.unsupported, "The native engine has no \(step.kind.rawValue) step.")
    }
  }

  /// One write step's settled inputs: the target, the observation it starts from, the surface
  /// it writes to and the route facts read right before the write, with its window's placement.
  struct Write {
    let ref: TargetRefWire
    let observation: NativeObservation
    let place: NativeSurfaceRead
    let facts: NativeRouteFacts
    let context: EngineStepContext
  }

  private func setValue(_ locator: ComputerLocatorWire, _ text: String, _ write: Write)
    async throws(ComputerFailure) -> EngineStepOutcome
  {
    let live = try await textElement(locator, write)
    let facts = write.facts
    let field = await typingField(write.ref, element: live.element, context: write.context)
    let written = try await self.write(
      text, replacing: true, ladder: { NativeRoutePlan.setValue(live, value: $0, facts: facts) },
      field: field, kind: .setValue, write)
    // The write went through; a failed read-back leaves it unconfirmed, not failed.
    let readBack: DriverSnapshotResult
    do throws(ComputerFailure) {
      readBack = try await freshSnapshot(write.ref, operation: write.context.operationId)
    } catch {
      return EngineStepOutcome(
        .dispatched, evidence: [.init(kind: .value, summary: "Text set; reading it back failed.")],
        invalidated: "observation", delivery: .background, route: written.route,
        receipt: written.receipt)
    }
    let after = NativeObservation.counterpart(of: live.element, in: readBack)
    let verified = NativeObservation.valueMatches(after?.value, text)
    return EngineStepOutcome(
      verified ? .verified : .dispatched,
      evidence: [
        .init(
          kind: .value,
          summary: verified
            ? "Set \(live.element.role) to \(text.count) characters; read back matches."
            : "Set \(live.element.role); the read-back value differs.")
      ], delivery: .background, route: written.route, receipt: written.receipt)
  }

  /// Empties a text field and reads it back: verified only when it reads empty. A field that
  /// kept its value fails as not applied; one that changed otherwise fails as unknown.
  private func clear(_ locator: ComputerLocatorWire, _ write: Write)
    async throws(ComputerFailure) -> EngineStepOutcome
  {
    let live = try await textElement(locator, write)
    let delivered = try await climb(
      NativeRoutePlan.setValue(live, value: "", facts: write.facts), kind: .clear,
      place: write.place, ref: write.ref, context: write.context)
    guard
      let snapshot = try? await freshSnapshot(write.ref, operation: write.context.operationId),
      let after = NativeObservation.counterpart(of: live.element, in: snapshot)
    else {
      return EngineStepOutcome(
        .dispatched, evidence: [.init(kind: .value, summary: "Cleared; reading it back failed.")],
        invalidated: "observation", delivery: .background, route: delivered.route,
        receipt: delivered.receipt)
    }
    if (after.value ?? "").isEmpty {
      return EngineStepOutcome(
        .verified,
        evidence: [.init(kind: .value, summary: "Cleared \(live.element.role); reads empty.")],
        delivery: .background, route: delivered.route, receipt: delivered.receipt)
    }
    let unchanged = after.value == live.element.value
    throw ComputerFailure(
      .unsupported,
      unchanged
        ? "The app ignored clearing the field; its value is unchanged."
        : "The field still holds text after clearing; check it before writing again.",
      mayHaveDispatched: !unchanged)
  }

  private func press(
    _ locator: ComputerLocatorWire, effect: ComputerStepWire.PressEffect, _ write: Write
  ) async throws(ComputerFailure) -> EngineStepOutcome {
    let element = try Self.element(locator, in: write.observation)
    guard element.enabled != false else {
      throw ComputerFailure(.unsupported, "The control is disabled.")
    }
    let live = try await liveElement(
      element, ref: write.ref, observation: write.observation, context: write.context)
    try dispatching(
      NativeTargetProbe.screenGeometry(live.element.frame?.cgRect), context: write.context)
    let delivered = try await climb(
      NativeRoutePlan.press(live, effect: effect, facts: write.facts), kind: .press,
      place: write.place, ref: write.ref, context: write.context)
    let verb =
      delivered.rung.primitives.contains(.axAction(element: live.token, action: .confirm))
      ? "Confirmed" : "Pressed"
    return Self.outcome(delivered, "\(verb) \(live.element.role) \(live.element.label ?? "")")
  }

  private func wait(
    _ condition: ComputerConditionWire, timeoutMs: Int, ref: TargetRefWire,
    baseline: NativeObservation, context: EngineStepContext
  ) async throws(ComputerFailure) -> EngineStepOutcome {
    context.report(.waiting)
    let limit = min(.now + .milliseconds(timeoutMs), context.deadline)
    var missed: ComputerFailure?
    let start = ContinuousClock.now
    var reads = 0
    defer { context.phases.add(.wait, since: start, count: reads) }
    while true {
      try dispatchable(context)
      reads += 1
      do throws(ComputerFailure) {
        if try await holds(
          condition, ref: ref, baseline: NativeObservation.texts(baseline.elements),
          screenBaseline: targets[ref.id]?.recognizedText, observation: baseline,
          operation: context.operationId)
        {
          return EngineStepOutcome(
            .notDispatched, evidence: [.init(kind: .text, summary: "The condition held.")])
        }
        missed = nil
      } catch let failure where Self.readsAgain(after: failure, condition) {
        missed = failure
      }
      guard ContinuousClock.now + Self.waitInterval < limit else { break }
      try? await Task.sleep(for: Self.waitInterval)
    }
    throw missed
      ?? ComputerFailure(.timeout, "The condition did not hold within \(timeoutMs) ms.")
  }

  /// An enabled text field or area `locator` names, with a token the driver resolves, reported
  /// as about to receive input.
  func textElement(_ locator: ComputerLocatorWire, _ write: Write)
    async throws(ComputerFailure) -> NativeRoutePlan.Element
  {
    let element = try Self.element(locator, in: write.observation)
    guard NativeObservation.textInputRoles.contains(element.role) else {
      throw ComputerFailure(.unsupported, "Only text fields and text areas take this step.")
    }
    guard element.enabled != false else {
      throw ComputerFailure(.unsupported, "The text field is disabled.")
    }
    let live = try await liveElement(
      element, ref: write.ref, observation: write.observation, context: write.context)
    try dispatching(
      NativeTargetProbe.screenGeometry(live.element.frame?.cgRect), context: write.context)
    return live
  }

  /// A delivered step with what it did as evidence, its route and the driver's receipt; one the
  /// driver found nothing to do for is not dispatched.
  static func outcome(_ delivered: Delivered, _ summary: String, invalidated: String? = nil)
    -> EngineStepOutcome
  {
    let via =
      switch delivered.route {
      case .accessibility: " through accessibility"
      case .menu: " through the menu"
      default: " through window-routed events"
      }
    return EngineStepOutcome(
      delivered.dispatched ? .dispatched : .notDispatched,
      evidence: [.init(kind: .text, summary: summary + via + ".")], invalidated: invalidated,
      delivery: .background, route: delivered.route, receipt: delivered.receipt)
  }
}
