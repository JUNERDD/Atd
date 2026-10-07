import AppKit

/// Follows the system's Reduce transparency setting (Accessibility › Display) for a page: WebKit
/// has no `prefers-reduced-transparency`, so the shell reports the setting and the page turns its
/// glass and fills opaque from it. Reports the current value at once and after every change of
/// the display options, until ``stop()``.
final class ReduceTransparencyObserver {
  private var observer: NSObjectProtocol?

  /// The setting now.
  static var isReduced: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency }

  /// Calls `report` with the current value now and again whenever the display options change
  /// (any option, so a report can repeat the previous value).
  init(report: @escaping @MainActor (_ reduce: Bool) -> Void) {
    report(Self.isReduced)
    observer = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil,
      queue: .main
    ) { _ in MainActor.assumeIsolated { report(Self.isReduced) } }
  }

  /// Ends the reports; the owner calls it when its page goes away.
  func stop() {
    guard let observer else { return }
    NSWorkspace.shared.notificationCenter.removeObserver(observer)
    self.observer = nil
  }
}
