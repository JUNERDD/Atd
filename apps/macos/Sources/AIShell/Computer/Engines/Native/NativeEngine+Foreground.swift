import AIComputerDriverKit
import AICore
import AppKit

/// The foreground fallback of a native step every background route refused (R1–R4, R13). The
/// step's locators are resolved again from the same observation, as the ladder resolves them, into
/// what a person would do in the app's window: a click at an element's visible centre or at text
/// found on screen, keys or text after focusing the element (its accessibility focus where that
/// route is open, else a click at its centre), a drag between two points inside the window.
/// Planning sends nothing. The window must be the target's own, not minimized, and on the active
/// Space as the window server tells it, outside full screen, since Atd never restores a window or
/// switches Spaces; a password field is refused, and so is input the app's toolkit would not take
/// as aimed: clicks for an app that follows the real pointer, keys for one that takes no posted
/// keys. Each piece then goes out through the background's own event route
/// (``foregroundSend(_:place:ref:context:)``): posted to the target's process and addressed to its
/// window, never through the HID system, never moving the person's pointer.
extension NativeEngine {
  func foreground(
    _ step: ComputerStepWire, on ref: TargetRefWire, observation: ObservationRefWire,
    refusal: ComputerFailure, context: EngineStepContext,
    run: (ForegroundPlan) async throws(ComputerFailure) -> EngineStepOutcome
  ) async throws(ComputerFailure) -> EngineStepOutcome {
    defer { stopping.remove(context.operationId) }
    let plan = try await foregroundPlan(
      step, on: ref, observation: observation, refusal: refusal, context: context)
    return try await run(plan)
  }

  private func foregroundPlan(
    _ step: ComputerStepWire, on ref: TargetRefWire, observation: ObservationRefWire,
    refusal: ComputerFailure, context: EngineStepContext
  ) async throws(ComputerFailure) -> ForegroundPlan {
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
    try requireAccessibility()
    try await requireUnblocked(ref, surface: named)
    let place = try observedRead(ref)
    guard place.pid == ref.native?.pid else {
      throw refusal.foregroundRefused("its surface belongs to another process")
    }
    guard CGPreflightPostEventAccess() else { throw refusal }
    let facts = try await writeFacts(ref, place: place, kind: step.kind, context: context)
    guard facts.placement == .activeSpace, facts.spaceKnown else {
      throw refusal.foregroundRefused(
        facts.spaceKnown
          ? "its window is on another Space or in full screen, and Atd never switches Spaces"
          : "Atd cannot tell whether its window is on the Space the person is using, and it "
            + "never switches Spaces",
        reason: facts.placement.eventRefusal ?? .offSpace)
    }
    guard ForegroundPolicy.reaches(step.kind, on: facts.toolkit) else {
      throw Self.unreached(step.kind, on: facts.toolkit, refusal)
    }
    let write = Write(ref: ref, observation: current, place: place, facts: facts, context: context)
    let (gestures, geometry) = try await foregroundGestures(step, refusal: refusal, write)
    return ForegroundPlan(
      pid: pid_t(place.pid), windowId: place.windowId, gestures: gestures, refusal: refusal,
      geometry: geometry
    ) { [self] (piece: ForegroundGesture) async throws(ComputerFailure) -> Bool in
      try await foregroundSend(piece, place: place, ref: ref, context: context)
    }
  }

  /// The gestures of `step` and where it shows in progress.
  private func foregroundGestures(
    _ step: ComputerStepWire, refusal: ComputerFailure, _ write: Write
  ) async throws(ComputerFailure) -> ([ForegroundGesture], ComputerGeometryWire?) {
    let (ref, observation, context) = (write.ref, write.observation, write.context)
    switch step {
    case .click(let locator, _, let count):
      let aim = try await aim(locator, ref: ref, in: observation, context: context, uses: false)
      guard let point = Self.point(of: aim) else {
        throw refusal.foregroundRefused("the element shows no point inside its window to click")
      }
      return ([.click(point, count: count ?? 1)], geometry(of: aim))
    case .key(let key, let modifiers, let locator):
      let chord = ForegroundGesture.chord(key, modifiers ?? [])
      guard let locator else { return ([chord], nil) }
      let element = try Self.element(locator, in: observation)
      let live = try await liveElement(
        element, ref: ref, observation: observation, context: context)
      return (
        try focus(live, refusal: refusal, write) + [chord],
        NativeTargetProbe.screenGeometry(live.element.frame?.cgRect)
      )
    case .type(let text, .element(let locator)?):
      let element = try Self.element(locator, in: observation)
      guard element.enabled != false else {
        throw ComputerFailure(.unsupported, "The element is disabled.")
      }
      let live = try await liveElement(
        element, ref: ref, observation: observation, context: context)
      return (
        try focus(live, refusal: refusal, write) + [.text(text)],
        NativeTargetProbe.screenGeometry(live.element.frame?.cgRect)
      )
    case .type(let text, nil):
      if observation.elements.contains(where: {
        $0.focused == true && NativeObservation.isSecret($0)
      }) {
        throw Self.secret
      }
      return ([.text(text)], try await focusedInputGeometry(ref))
    case .drag(let from, let to):
      let start = Self.point(try await dragPoint(from, write))
      let end = Self.point(try await dragPoint(to, write))
      let frame = NativeSurfaceProbe.frame(
        windowId: write.place.windowId, pid: pid_t(write.place.pid))
      guard let frame, frame.contains(start), frame.contains(end) else {
        throw refusal.foregroundRefused(
          "the drag leaves its window, and Atd drags only within one window", reason: .dragAndDrop)
      }
      return ([.drag(from: start, to: end)], nil)
    default:
      throw refusal
    }
  }

  /// What makes `element` take the step's keys, the way the ladder focuses it
  /// (``NativeRoutePlan/focusing(_:)``): its accessibility focus where that route is open, sent
  /// with the rest of the step once the target is in front, with a click at its visible centre
  /// when the app declines it; else that click.
  private func focus(
    _ element: NativeRoutePlan.Element, refusal: ComputerFailure, _ write: Write
  ) throws(ComputerFailure) -> [ForegroundGesture] {
    guard !NativeObservation.isSecret(element.element) else { throw Self.secret }
    let point = element.point.map { Self.point($0) }
    if case .axFocus(let token)? = NativeRoutePlan.focusing(element)?.first,
      write.facts.exclusion(of: .axAction) == nil
    {
      return [.focus(element: token, fallback: point)]
    }
    guard let point else {
      throw refusal.foregroundRefused("the element can be neither focused nor clicked")
    }
    return [.click(point, count: 1)]
  }

  /// Sends one piece of a foreground step to the step's window as
  /// ``deliver(_:kind:place:ref:context:committed:)`` sends a background rung's primitive, without
  /// waiting for the person: the executor waited for their pause and stops at their input. False
  /// when the app declined an element's focus before anything went out.
  func foregroundSend(
    _ piece: ForegroundGesture, place: NativeSurfaceRead, ref: TargetRefWire,
    context: EngineStepContext
  ) async throws(ComputerFailure) -> Bool {
    let primitive = Self.primitive(piece)
    try dispatchable(context)
    let remaining = context.deadline - .now
    guard remaining > Self.leastSendTime else {
      throw ComputerFailure(.timeout, "The step's deadline passed before all of it was sent.")
    }
    let budget = min(remaining - .milliseconds(200), .seconds(8))
    let request = DriverPerformRequest(
      target: place.driverTarget, primitive: primitive, routeAllow: [primitive.route],
      deadlineMilliseconds: budget / .milliseconds(1),
      userTypedWithinGuard: NativeTypingGuard.wait(
        lastInput: context.lastPersonInput(), now: .now) != nil)
    targets[ref.id]?.acted = true
    let sent = ContinuousClock.now
    let result = await self.request(
      .perform(request), timeout: budget + Self.performGrace, operation: context.operationId)
    context.phases.add(.perform, since: sent)
    switch result {
    case .success(.perform(let performed)):
      if let scope = performed.receipt.keyScope, scope.used {
        Self.log.notice(
          "Foreground piece used a key scope: route=\(primitive.route.rawValue, privacy: .public) returned=\(scope.returned)"
        )
      }
      return true
    case .success:
      throw ComputerFailure(
        .engineFailed, "The driver answered a perform unexpectedly.", mayHaveDispatched: true)
    case .failure(.refused(let refusal)):
      if case .focus = piece, NativeDriverFailureMap.degrades(refusal) { return false }
      let mapped = NativeDriverFailureMap.perform(refusal)
      throw ComputerFailure(
        mapped.code,
        "The driver refused this step's input in the foreground: "
          + (refusal.message ?? refusal.code.rawValue),
        mayHaveDispatched: mapped.mayHaveDispatched, reason: mapped.reason)
    case .failure(let failure):
      throw self.failure(failure, kind: "foreground step", writes: true)
    }
  }

  /// The driver's primitive for one piece: the background's window-routed events, or the
  /// element's accessibility focus.
  private static func primitive(_ piece: ForegroundGesture) -> DriverPrimitive {
    switch piece {
    case .click(let point, let count): .pointer(point: driverPoint(point), clickCount: count)
    case .drag(let from, let to): .drag(from: driverPoint(from), to: driverPoint(to))
    case .focus(let element, _): .axFocus(element: element)
    case .chord(let key, let modifiers):
      .keys(chord: NativeKeyChord.chord(key, modifiers: modifiers))
    case .text(let run): .text(text: run)
    }
  }

  /// Why the foreground's input for a `kind` step would miss a `toolkit` window
  /// (``ForegroundPolicy/reaches(_:on:)``).
  private static func unreached(
    _ kind: ComputerStepKind, on toolkit: DriverToolkit, _ refusal: ComputerFailure
  ) -> ComputerFailure {
    switch kind {
    case .click, .drag:
      refusal.foregroundRefused(
        "input posted to this app's window misses even in front, since it follows the real "
          + "pointer or draws a surface of its own, and Atd never moves the person's pointer",
        reason: NativeRoutePolicy.pointerRefusal(on: toolkit))
    default:
      refusal.foregroundRefused("this app takes no keys Atd posts to it, in front or not")
    }
  }

  private static let secret = ComputerFailure.noBackgroundRoute(
    .secureInput,
    "The step would type into a password field, which Atd never does, in the background or the "
      + "foreground. Nothing was sent.")

  private static func point(of aim: NativeRoutePlan.Aim) -> CGPoint? {
    switch aim {
    case .element(let element): element.point.map { Self.point($0) }
    case .point(let point), .text(let point, _): Self.point(point)
    }
  }

  private static func point(_ point: DriverPoint) -> CGPoint {
    CGPoint(x: point.x, y: point.y)
  }

  private static func driverPoint(_ point: CGPoint) -> DriverPoint {
    DriverPoint(x: point.x, y: point.y)
  }
}
