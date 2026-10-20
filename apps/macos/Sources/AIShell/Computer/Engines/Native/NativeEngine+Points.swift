import AIComputerDriverKit
import AICore
import CoreGraphics

/// Where a step acts (plan §4.2, §5.2 step 4): an element of the observation, with the token of
/// its window's newest snapshot and the point an event rung aims at, or a point of a capture the
/// host returned. A capture point is mapped to the screen only while the capture is the newest
/// of its surface's window, within its use-by time and still showing the window: an unused,
/// uncropped root-window capture keeps its points through a pure move (the host maps them through
/// the live origin), every other one needs the recorded frame. A click, a drag or a caret
/// placement uses a capture once.
extension NativeEngine {
  /// The element `locator` names in the observation the action started from.
  static func element(_ locator: ComputerLocatorWire, in observation: NativeObservation)
    throws(ComputerFailure) -> DriverElement
  {
    switch observation.resolve(locator) {
    case .success(let element): return element
    case .failure(let failure): throw ComputerFailure(failure.code, failure.message)
    }
  }

  /// What a pointer step aims at; `uses` marks a capture point's capture used. A locator that
  /// names only text no element of the observation holds is aimed at that text on screen.
  func aim(
    _ locator: ComputerPointLocatorWire, ref: TargetRefWire, in observation: NativeObservation,
    context: EngineStepContext, uses: Bool
  ) async throws(ComputerFailure) -> NativeRoutePlan.Aim {
    switch locator {
    case .element(let locator):
      switch observation.resolve(locator) {
      case .success(let found):
        guard found.enabled != false else {
          throw ComputerFailure(.unsupported, "The element is disabled.")
        }
        return .element(
          try await liveElement(found, ref: ref, observation: observation, context: context))
      case .failure(let failure):
        if failure == .notFound, let text = NativeRecognizedText.text(of: locator) {
          return try await textAim(text, ref: ref, context: context)
        }
        throw ComputerFailure(failure.code, failure.message)
      }
    case .imagePoint(let point):
      return .point(try await screenPoint(point, ref: ref, context: context, uses: uses))
    }
  }

  /// `element` with a token the driver still resolves: the observation's own while its snapshot
  /// is its window's newest, otherwise the same element in a fresh snapshot. Reports where it is.
  func liveElement(
    _ element: DriverElement, ref: TargetRefWire, observation: NativeObservation,
    context: EngineStepContext?
  ) async throws(ComputerFailure) -> NativeRoutePlan.Element {
    var live = element
    var snapshotId = observation.snapshotId
    let place = try observedRead(ref)
    if snapshots[place.windowKey] != observation.snapshotId {
      let snapshot = try await freshSnapshot(ref, surface: place, operation: context?.operationId)
      guard let counterpart = NativeObservation.counterpart(of: element, in: snapshot) else {
        throw ComputerFailure(
          .staleObservation, "The window changed since it was observed; observe it again.")
      }
      live = counterpart
      snapshotId = snapshot.snapshotId
    }
    if let context, let geometry = NativeTargetProbe.screenGeometry(live.frame?.cgRect) {
      context.report(.located(geometry))
    }
    return NativeRoutePlan.Element(
      token: NativeObservation.token(snapshotId: snapshotId, live), element: live,
      point: visibleCenter(of: live, clippedBy: observation.scrollAncestors(of: element), in: place)
    )
  }

  /// The element's centre when it shows: inside the surface's part of its window and inside every
  /// scroll area around it, so an event aimed there reaches the element, not what covers it.
  private func visibleCenter(
    of element: DriverElement, clippedBy areas: [CGRect], in place: NativeSurfaceRead
  ) -> DriverPoint? {
    guard let frame = element.frame?.cgRect, frame.width > 0, frame.height > 0,
      let window = NativeSurfaceProbe.frame(windowId: place.windowId, pid: pid_t(place.pid))
    else { return nil }
    let visible = areas.reduce(place.cropFrame.map { $0.intersection(window) } ?? window) {
      $0.intersection($1)
    }
    let center = CGPoint(x: frame.midX, y: frame.midY)
    guard !visible.isNull, visible.contains(center) else { return nil }
    return DriverPoint(x: center.x, y: center.y)
  }

  /// The screen point a capture point names, after the capture checks above.
  func screenPoint(
    _ point: ComputerImagePointWire, ref: TargetRefWire, context: EngineStepContext, uses: Bool
  ) async throws(ComputerFailure) -> DriverPoint {
    guard let target = targets[ref.id], let place = target.observed,
      let capture = target.captures.first(where: { $0.id == point.capture })
    else { throw Self.staleCapture("is not a current capture of the target") }
    guard !capture.isExpired else {
      throw Self.staleCapture("passed its use-by time; observe again and relocate")
    }
    guard capture.surfaceRefId == place.surfaceRefId, capture.pid == place.pid,
      capture.windowId == place.windowId
    else { throw Self.staleCapture("shows another surface than the one the action acts on") }
    guard target.latestShot[place.windowKey] == capture.id else {
      throw Self.staleCapture("was replaced by a newer capture of the window")
    }
    guard capture.contains(x: point.x, y: point.y) else {
      throw Self.staleCapture("does not contain the point")
    }
    let used = target.spent.contains(capture.id)
    if uses, used { throw Self.staleCapture("has already been used for input") }
    let (pid, windowId) = (pid_t(capture.pid), capture.windowId)
    guard
      let live = await NativeTargetProbe.detached({
        NativeSurfaceProbe.frame(windowId: windowId, pid: pid)
      })
    else { throw Self.staleCapture("shows a window that is gone") }
    let translates = !used && place.surfaceRefId == nil && capture.crop == nil
    guard translates ? capture.matches(size: live.size) : capture.matches(frame: live) else {
      throw Self.staleCapture("no longer matches the window geometry required by this action")
    }
    let screen = capture.screenPoint(x: point.x, y: point.y, windowOrigin: live.origin)
    if let geometry = NativeTargetProbe.screenGeometry(
      CGRect(x: screen.x - 1, y: screen.y - 1, width: 2, height: 2))
    {
      context.report(.located(geometry))
    }
    if uses { targets[ref.id]?.spent.insert(capture.id) }
    return DriverPoint(x: screen.x, y: screen.y)
  }

  /// Where the step acts, for the progress the coordinator shows.
  func geometry(of aim: NativeRoutePlan.Aim) -> ComputerGeometryWire? {
    switch aim {
    case .element(let element): NativeTargetProbe.screenGeometry(element.element.frame?.cgRect)
    case .point(let point), .text(let point, _):
      NativeTargetProbe.screenGeometry(CGRect(x: point.x - 1, y: point.y - 1, width: 2, height: 2))
    }
  }

  /// A text step without a locator writes to the existing focus. Its display feedback may use
  /// that field only when accessibility proves it belongs to the action's exact surface.
  func focusedInputGeometry(_ ref: TargetRefWire) async throws(ComputerFailure)
    -> ComputerGeometryWire?
  {
    let place = try observedRead(ref)
    guard
      let field = await NativeTargetProbe.detached({
        NativeSurfaceProbe.focusedTextFrame(windowId: place.windowId, pid: pid_t(place.pid))
      }), place.cropFrame?.contains(field) != false
    else { return nil }
    return NativeTargetProbe.screenGeometry(field)
  }

  /// The surface's visible part of its window, where a step without a locator aims (a scroll of
  /// the window); a sheet or popover stays inside its observed crop.
  func surfaceFrame(_ ref: TargetRefWire) throws(ComputerFailure) -> CGRect? {
    let place = try observedRead(ref)
    guard let frame = NativeSurfaceProbe.frame(windowId: place.windowId, pid: pid_t(place.pid))
    else { return nil }
    let visible = place.cropFrame.map { $0.intersection(frame) } ?? frame
    return visible.isNull || visible.isEmpty ? nil : visible
  }

  /// The last check before input is sent, reported as dispatching at `geometry`.
  func dispatching(_ geometry: ComputerGeometryWire?, context: EngineStepContext)
    throws(ComputerFailure)
  {
    try dispatchable(context)
    context.report(.dispatching(geometry))
  }

  static func staleCapture(_ reason: String) -> ComputerFailure {
    ComputerFailure(.staleObservation, "The capture \(reason); observe the target again.")
  }
}

extension NativeObservation {
  /// The frames of the scroll areas around `element`, innermost first.
  func scrollAncestors(of element: DriverElement) -> [CGRect] {
    var frames: [CGRect] = []
    var current = parent(of: element)
    while let ancestor = current {
      if ancestor.role == "AXScrollArea", let frame = ancestor.frame?.cgRect {
        frames.append(frame)
      }
      current = parent(of: ancestor)
    }
    return frames
  }
}
