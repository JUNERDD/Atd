import AIComputerDriverKit
import ApplicationServices
import CoreGraphics
import Foundation

/// Resolves a `DriverTarget` (pid + window number) to the live AX window element and reports where
/// the window sits relative to the user, so the host can refuse `minimized`/`offSpace`/
/// `fullScreen` before any write and the driver never changes window visibility.
enum WindowResolver {
  struct Resolved {
    let app: AXUIElement
    let window: AXUIElement
    let bounds: CGRect
  }

  /// Find the AX window whose WindowServer id matches `target`. Returns nil when the process or
  /// window is gone, or the app exposes no matching AX window.
  static func resolve(_ target: DriverTarget) -> Resolved? {
    let pid = pid_t(target.pid)
    let wanted = CGWindowID(target.windowId)
    guard WindowList.windowMatches(wanted, pid: pid) else { return nil }
    let app = AXBindings.application(pid: pid)
    for window in AXBindings.copyElements(app, kAXWindowsAttribute as String) {
      if WindowServerQueries.windowId(for: window) == wanted {
        let bounds = AXBindings.frame(window) ?? WindowList.window(wanted)?.bounds ?? .zero
        return Resolved(app: app, window: window, bounds: bounds)
      }
    }
    // The app may not list the window in AXWindows (some Chromium popovers); fall back to the
    // CGWindowList bounds with the app element, so reads/actions by element token still work.
    guard let facts = WindowList.window(wanted) else { return nil }
    return Resolved(app: app, window: app, bounds: facts.bounds)
  }

  /// Where the window sits: minimized, on the active Space, in a full-screen Space.
  static func placement(_ target: DriverTarget, window: AXUIElement) -> DriverWindowPlacement {
    let minimized =
      AXBindings.copyBool(window, kAXMinimizedAttribute as String) == true
      || (!onScreen(target) && !WindowList.appIsHidden(pid: pid_t(target.pid))
        && offScreenNoSpace(target))
    let onActive: Bool
    if let spaces = WindowServerQueries.spaces(forWindow: CGWindowID(target.windowId)),
      let active = WindowServerQueries.activeSpace()
    {
      onActive = spaces.contains(active)
    } else {
      onActive = true  // cannot tell; do not falsely refuse as off-Space
    }
    let fullScreen = AXBindings.copyBool(window, "AXFullScreen") == true
    return DriverWindowPlacement(
      minimized: minimized, onActiveSpace: onActive, fullScreen: fullScreen)
  }

  private static func onScreen(_ target: DriverTarget) -> Bool {
    WindowList.window(CGWindowID(target.windowId))?.isOnScreen ?? false
  }

  /// A window that is off-screen and belongs to no Space is minimized (as opposed to on another
  /// Space, which still reports Space membership).
  private static func offScreenNoSpace(_ target: DriverTarget) -> Bool {
    (WindowServerQueries.spaces(forWindow: CGWindowID(target.windowId))?.isEmpty ?? true)
  }
}
