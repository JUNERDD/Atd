import AICore
import AppKit
import CoreGraphics

/// What the person sees at one moment, as the disturbance guard reads it before and after a write
/// step (plan §4.3): the frontmost app, whether a window of the target covers the person's front
/// window, how many windows the frontmost app shows, the pointer and the pasteboard's change count,
/// and Atd's own window that holds the keyboard while another app is active. Read from
/// WindowServer and AppKit only, never with accessibility calls into other apps, and without window
/// titles, so it needs no Screen Recording grant. The reading before a step is also what the
/// foreground fallback puts back (``ForegroundScene``).
struct DisturbanceSnapshot {
  private let capturedAt: TimeInterval
  private let windows: [Window]
  let frontmost: pid_t?
  /// The person's front window: the frontmost app's topmost window, by window number.
  let personWindow: Int?
  /// Atd's window that holds the keyboard while another app is active (the task panel never
  /// activates Atd), by window number; nil otherwise.
  let panel: Int?
  /// Whether a window of the target is above ``personWindow`` in the on-screen order and overlaps
  /// it. The order is global across displays, so a target window brought up on another display
  /// precedes the person's window without covering anything of it.
  let targetAbove: Bool
  /// The frontmost app's windows on screen.
  let personWindows: Int?
  let pointer: CGPoint?
  let pasteboard: Int

  struct Window: Encodable {
    let number: Int
    let pid: pid_t
    let order: Int
    let layer: Int
    /// In global display coordinates, the same space for every window in the list.
    let bounds: CGRect
  }

  /// Reads the moment for a step on `target`. `personWindow` names the window to compare with
  /// after the step, so a raise is judged against the window the person had in front before it;
  /// nil takes the frontmost app's topmost one.
  static func read(target: Set<pid_t>, personWindow: Int? = nil) -> DisturbanceSnapshot {
    let capturedAt = Date().timeIntervalSince1970
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
      capturedAt: capturedAt, windows: windows,
      frontmost: frontmost, personWindow: reference.map { windows[$0].number },
      panel: NSApp.isActive ? nil : NSApp.keyWindow?.windowNumber, targetAbove: above ?? false,
      personWindows: frontmost.map { pid in windows.count(where: { $0.pid == pid }) },
      pointer: CGEvent(source: nil)?.location, pasteboard: NSPasteboard.general.changeCount)
  }

  /// Whether the pointer moved by more than a point between `self` and `later`.
  func pointerMoved(by later: DisturbanceSnapshot) -> Bool {
    guard let start = pointer, let end = later.pointer else { return false }
    return hypot(end.x - start.x, end.y - start.y) > 1
  }

  struct Diagnostic: Encodable {
    let capturedAt: TimeInterval
    let frontmost: pid_t?
    let personWindow: Int?
    let panel: Int?
    let targetAbove: Bool
    let windows: [Window]
  }

  private struct RaiseDiagnostic: Encodable {
    let targetPids: [pid_t]
    let personInput: Int
    let activated: [pid_t]
    let foregroundRestoration: String?
    let before: Diagnostic
    let after: Diagnostic
  }

  /// Uses the guard's original two samples, never a later read after restoration.
  static func raiseMetadata(
    before: Self, after: Self, reading: DisturbanceReading
  ) -> String? {
    let payload = RaiseDiagnostic(
      targetPids: reading.target.sorted(), personInput: reading.personInput.rawValue,
      activated: reading.activated,
      foregroundRestoration: reading.receipt?.foreground?.front.rawValue,
      before: before.diagnostic(target: reading.target),
      after: after.diagnostic(target: reading.target))
    guard let data = try? JSONEncoder().encode(payload) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  func diagnostic(target: Set<pid_t>) -> Diagnostic {
    Diagnostic(
      capturedAt: capturedAt, frontmost: frontmost, personWindow: personWindow, panel: panel,
      targetAbove: targetAbove,
      windows: windows.filter { target.contains($0.pid) || $0.number == personWindow })
  }

  /// The windows people work in, front to back: on screen, below the menu bar's level (so menus,
  /// the Dock's own level and above, tooltips and overlays do not count) and not the desktop.
  private static func onScreenWindows() -> [Window] {
    let list =
      CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
      ?? []
    let ceiling = Int(CGWindowLevelForKey(.mainMenuWindow))
    return list.enumerated().compactMap { order, info in
      guard let number = info[kCGWindowNumber as String] as? Int,
        let pid = info[kCGWindowOwnerPID as String] as? pid_t,
        let layer = info[kCGWindowLayer as String] as? Int, (0..<ceiling).contains(layer),
        let frame = info[kCGWindowBounds as String] as? NSDictionary,
        let bounds = CGRect(dictionaryRepresentation: frame as CFDictionary)
      else { return nil }
      return Window(number: number, pid: pid, order: order, layer: layer, bounds: bounds)
    }
  }
}
