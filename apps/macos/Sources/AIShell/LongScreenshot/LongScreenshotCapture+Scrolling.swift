import AICore
import AppKit

/// Scrolling during the live phase: Atd's own (decision D4) and the user's, which both tell the
/// engine where the page was asked to go, the evidence for its ends (D6).
///
/// Atd scrolls in a closed loop that ``LongScreenshotAutoScroll`` paces from what the stitched
/// frames show: each step is posted as a continuous pixel scroll-wheel event inside the band at
/// the HID level, and the next waits until the page answered it. The events come from a private
/// source and carry ``scrollEventMarker``, so monitors can leave them out
/// (``isSynthesized(_:)``).
extension LongScreenshotCapture {
  /// "ATDSCROL" in ASCII: the marker in `eventSourceUserData` of every scroll event Atd posts.
  nonisolated static let scrollEventMarker: Int64 = 0x4154_4453_4352_4F4C
  /// How often the loop looks at the stitch again: under half a frame of the stream.
  static let pollInterval = Duration.milliseconds(30)

  /// Whether `event`, as an event monitor received it, is one auto-scroll posted: it carries the
  /// marker, or Atd's process posted it, whichever of the two fields it kept on its way (as
  /// ``KeyPress/isSynthesized(_:)`` reads them).
  nonisolated static func isSynthesized(_ event: NSEvent) -> Bool {
    guard let event = event.cgEvent else { return false }
    return event.getIntegerValueField(.eventSourceUserData) == scrollEventMarker
      || event.getIntegerValueField(.eventSourceUnixProcessID) == Int64(getpid())
  }

  /// Turns auto-scroll on: `.needsPermission` without the grant to post events, `.atLimit` once
  /// the image is as long as it can be. Scrolls down until the page ends, the image reaches its
  /// limit, stitching loses the page for good, the user scrolls, or ``stopAutoScroll()``.
  func startAutoScroll() -> LongScreenshotAutoScrollStart {
    if progress.reachedLimit { return .atLimit }
    guard CGPreflightPostEventAccess() else { return .needsPermission }
    guard autoScroll == nil, !ended else { return .started }
    autoScroll = Task { [weak self] in
      await self?.scrollToEnd()
      // A cancelled loop was already ended by whoever cancelled it, and a newer one may run.
      guard !Task.isCancelled else { return }
      self?.autoScrollEnded()
    }
    var next = progress
    next.autoScrolling = true
    publish(next)
    return .started
  }

  func stopAutoScroll() {
    guard let autoScroll else { return }
    autoScroll.cancel()
    autoScrollEnded()
  }

  /// The user scrolled over the selection by `deltaY` points, positive towards the page's
  /// start (AppKit's `scrollingDeltaY`, natural scrolling already applied; lines converted to
  /// points by the caller). Atd's own scrolling stops: the user took over.
  func userScrolled(deltaY: CGFloat) {
    guard deltaY != 0, !ended, let engine else { return }
    stopAutoScroll()
    engine.request(
      deltaY > 0 ? .up : .down, points: abs(deltaY), auto: false, at: Self.now)
    checkEdges()
  }

  // MARK: Private

  private static var now: Double { ProcessInfo.processInfo.systemUptime }

  /// The band in Quartz points: where scroll events go.
  private var bandCenter: CGPoint {
    let band = target.scrollArea.map { $0.intersection(target.selection) } ?? target.selection
    let local = band.isNull || band.isEmpty ? target.selection : band
    return CGPoint(
      x: target.displayFrame.minX + local.midX, y: target.displayFrame.minY + local.midY)
  }

  /// The loop: what the pacer says, until it stops. Before the first frame is stitched it only
  /// waits (a step then would scroll away the start the selection framed), and the engine may
  /// not exist yet.
  private func scrollToEnd() async {
    let location = bandCenter
    var pacer = LongScreenshotAutoScroll(at: Self.now)
    while !Task.isCancelled, !ended {
      engine?.tick(at: Self.now)
      let seen = engine?.autoScrollObservation ?? .init(started: false)
      switch pacer.next(seen, at: Self.now) {
      case .wait:
        try? await Task.sleep(for: Self.pollInterval)
      case .scroll(let direction, let points):
        guard let engine, Self.post(direction, points: points, at: location) else { return }
        engine.request(direction, points: points, auto: true, at: Self.now)
      case .stop:
        return
      }
    }
  }

  private func autoScrollEnded() {
    autoScroll = nil
    guard progress.autoScrolling else { return }
    var next = progress
    next.autoScrolling = false
    publish(next)
  }

  /// Ticks the engine for a while after the user's scrolling, so a request the page did not
  /// answer, or a bounce that settled, shows the edge even when no frame arrives.
  private func checkEdges() {
    edgeCheck?.cancel()
    edgeCheck = Task { [weak self] in
      for _ in 0..<6 {
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled, let engine = self?.engine else { return }
        engine.tick(at: Self.now)
      }
    }
  }

  /// One continuous scroll of `points` towards `direction`'s edge of the page at `location`
  /// (Quartz), from a private source at the HID level, marked. False when the event cannot be
  /// made.
  private static func post(
    _ direction: LongScreenshotDirection, points: CGFloat, at location: CGPoint
  ) -> Bool {
    // Negative wheel deltas scroll towards the end (content moves up), unaffected by natural
    // scrolling, which applies to devices only.
    let delta = Int32(points.rounded())
    guard let source = CGEventSource(stateID: .privateState),
      let event = CGEvent(
        scrollWheelEvent2Source: source, units: .pixel, wheelCount: 1,
        wheel1: direction == .down ? -delta : delta, wheel2: 0, wheel3: 0)
    else { return false }
    event.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
    event.setIntegerValueField(.eventSourceUserData, value: scrollEventMarker)
    event.location = location
    event.flags = []
    event.post(tap: .cghidEventTap)
    return true
  }
}
