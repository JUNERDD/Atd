import AICore
import AppKit

/// Scrolling during the live phase: Atd's own (decision D4) and the user's, which both tell the
/// engine where the page was asked to go, the evidence for its ends (D6).
///
/// Atd scrolls in a closed loop that ``LongScreenshotAutoScroll`` paces from what the stitched
/// frames show: each step is delivered as a window-routed continuous pixel scroll-wheel event
/// through ``LongScreenshotAutoScroller`` without moving the real cursor, and the next waits until
/// the page answered it. Events carry ``scrollEventMarker`` or the computer-driver tag, so
/// monitors can leave them out (``isSynthesized(_:)``).
extension LongScreenshotCapture {
  /// "ATDSCROL" in ASCII: the marker in `eventSourceUserData` of fallback scroll events Atd posts.
  nonisolated static let scrollEventMarker: Int64 = 0x4154_4453_4352_4F4C
  /// How often the loop looks at the stitch again: under half a frame of the stream.
  static let pollInterval = Duration.milliseconds(30)

  /// Whether `event`, as an event monitor received it, is one auto-scroll posted (either by the
  /// `atd-computer-driver` helper or directly by Atd's fallback): it carries ``scrollEventMarker``
  /// or the driver's tag, or Atd's process posted it.
  nonisolated static func isSynthesized(_ event: NSEvent) -> Bool {
    guard let event = event.cgEvent else { return false }
    let marker = event.getIntegerValueField(.eventSourceUserData)
    return marker == scrollEventMarker
      || (UInt64(bitPattern: marker) & 0xFFFF_FFFF_0000_0000) == 0x0A1D_0000_0000_0000
      || event.getIntegerValueField(.eventSourceUnixProcessID) == Int64(getpid())
  }

  /// Turns auto-scroll on: `.needsPermission` without the grant to post events, `.atLimit` once
  /// the image is as long as it can be. Scrolls down until the page ends, the image reaches its
  /// limit, stitching loses the page for good, the user scrolls, or ``stopAutoScroll()``.
  func startAutoScroll() -> LongScreenshotAutoScrollStart {
    if progress.reachedLimit { return .atLimit }
    guard CGPreflightPostEventAccess() else { return .needsPermission }
    guard autoScroll == nil, !ended else { return .started }
    acceptsUserMomentum = false
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

  /// The user scrolled the live page by `deltaY` points, positive towards the page's start
  /// (AppKit's `scrollingDeltaY`, natural scrolling already applied; lines converted to points by
  /// the caller). Atd's own scrolling stops on intentional manual input: the user took over.
  func directUserScrolled(_ event: NSEvent, deltaY: CGFloat) {
    guard !ended else { return }
    if let driverPID = autoScroller.driverPID,
      event.cgEvent?.getIntegerValueField(.eventSourceUnixProcessID) == Int64(driverPID)
    {
      return
    }
    if event.momentumPhase != [] {
      guard acceptsUserMomentum, autoScroll == nil else { return }
    } else if event.phase == .began || deltaY != 0 {
      stopAutoScroll()
      acceptsUserMomentum = true
    }
    guard deltaY != 0, let engine else { return }
    engine.request(deltaY > 0 ? .up : .down, points: abs(deltaY), auto: false, at: Self.now)
    checkEdges()
  }

  // MARK: Private

  private static var now: Double { ProcessInfo.processInfo.systemUptime }

  private var resolvedScrollLocation: CGPoint { scrollLocation?() ?? bandCenter }

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
    if target.windowID != nil {
      _ = await autoScroller.prepare()
      guard !Task.isCancelled, !ended else { return }
    }
    var pacer = LongScreenshotAutoScroll(at: Self.now)
    while !Task.isCancelled, !ended {
      engine?.tick(at: Self.now)
      let seen = engine?.autoScrollObservation ?? .init(started: false)
      switch pacer.next(seen, at: Self.now) {
      case .wait:
        try? await Task.sleep(for: Self.pollInterval)
      case .scroll(let direction, let points):
        let location = resolvedScrollLocation
        guard let pid = target.pid,
          await autoScroller.scroll(
            pid: pid, windowID: target.windowID, direction: direction, points: points,
            at: location),
          !Task.isCancelled, !ended, let engine
        else { return }
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
}
