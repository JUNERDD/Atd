import AppKit
import CoreGraphics

/// What the person sees at one moment, as the disturbance guard reads it before and after a write
/// step (plan §4.3): the frontmost app, whether a window of the target covers the person's front
/// window, how many windows the frontmost app shows, the pointer and the pasteboard's change count.
/// Read from WindowServer and AppKit only, never with accessibility calls into other apps, and
/// without window titles, so it needs no Screen Recording grant.
struct DisturbanceSnapshot {
  let frontmost: pid_t?
  /// The person's front window: the frontmost app's topmost window, by window number.
  let personWindow: Int?
  /// Whether a window of the target is above ``personWindow`` in the on-screen order and overlaps
  /// it. The order is global across displays, so a target window brought up on another display
  /// precedes the person's window without covering anything of it.
  let targetAbove: Bool
  /// The frontmost app's windows on screen.
  let personWindows: Int?
  let pointer: CGPoint?
  let pasteboard: Int

  private struct Window {
    let number: Int
    let pid: pid_t
    /// In global display coordinates, the same space for every window in the list.
    let bounds: CGRect
  }

  /// Reads the moment for a step on `target`. `personWindow` names the window to compare with
  /// after the step, so a raise is judged against the window the person had in front before it;
  /// nil takes the frontmost app's topmost one.
  static func read(target: Set<pid_t>, personWindow: Int? = nil) -> DisturbanceSnapshot {
    let frontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let windows = onScreenWindows()
    let reference =
      personWindow.flatMap { number in windows.firstIndex { $0.number == number } }
      ?? frontmost.flatMap { pid in windows.firstIndex { $0.pid == pid } }
    let above = reference.map { index in
      windows[..<index].contains { window in
        target.contains(window.pid) && !window.bounds.intersection(windows[index].bounds).isEmpty
      }
    }
    return DisturbanceSnapshot(
      frontmost: frontmost, personWindow: reference.map { windows[$0].number },
      targetAbove: above ?? false,
      personWindows: frontmost.map { pid in windows.count(where: { $0.pid == pid }) },
      pointer: CGEvent(source: nil)?.location, pasteboard: NSPasteboard.general.changeCount)
  }

  /// Whether the pointer moved by more than a point between `self` and `later`.
  func pointerMoved(by later: DisturbanceSnapshot) -> Bool {
    guard let start = pointer, let end = later.pointer else { return false }
    return hypot(end.x - start.x, end.y - start.y) > 1
  }

  /// The windows people work in, front to back: on screen, below the menu bar's level (so menus,
  /// the Dock's own level and above, tooltips and overlays do not count) and not the desktop.
  private static func onScreenWindows() -> [Window] {
    let list =
      CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
      ?? []
    let ceiling = Int(CGWindowLevelForKey(.mainMenuWindow))
    return list.compactMap { info in
      guard let number = info[kCGWindowNumber as String] as? Int,
        let pid = info[kCGWindowOwnerPID as String] as? pid_t,
        let layer = info[kCGWindowLayer as String] as? Int, (0..<ceiling).contains(layer),
        let frame = info[kCGWindowBounds as String] as? NSDictionary,
        let bounds = CGRect(dictionaryRepresentation: frame as CFDictionary)
      else { return nil }
      return Window(number: number, pid: pid, bounds: bounds)
    }
  }
}
