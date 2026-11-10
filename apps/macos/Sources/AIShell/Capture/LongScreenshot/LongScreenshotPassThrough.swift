import AppKit

/// What the live long screenshot sees of the input that passes through its overlays to the app
/// under the selection (decision D1): two global monitors, which see only events delivered to
/// other apps, so only what went through the selection's transparent hole. A click there
/// activates that app and takes the keyboard from the overlay: ``onClickThrough`` follows the
/// button's release, for the session to make its overlay key again. ``onScroll`` gets the user's
/// scrolling there; the scroll events Atd posts itself (auto-scroll's,
/// ``LongScreenshotCapture/isSynthesized(_:)``) are left out. The session
/// owns them for the live phase only, from ``start()`` to ``stop()``.
final class LongScreenshotPassThrough {
  var onClickThrough: (() -> Void)?
  var onScroll: ((NSEvent) -> Void)?
  private var monitors: [Any] = []

  func start() {
    guard monitors.isEmpty else { return }
    let clicks = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseUp) { [weak self] _ in
      MainActor.assumeIsolated { self?.onClickThrough?() }
    }
    let scrolls = NSEvent.addGlobalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
      guard !LongScreenshotCapture.isSynthesized(event) else { return }
      MainActor.assumeIsolated { self?.onScroll?(event) }
    }
    monitors = [clicks, scrolls].compactMap(\.self)
  }

  func stop() {
    for monitor in monitors { NSEvent.removeMonitor(monitor) }
    monitors = []
  }
}
