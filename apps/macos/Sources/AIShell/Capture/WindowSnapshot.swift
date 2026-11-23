import AICore
import AppKit
import CoreGraphics

/// The windows on screen when a capture starts, front to back, taken before any overlay
/// appears: element detection decides from it which app is under a point, because hit-testing
/// the live screen would answer with the overlay. The screen-context attachment names the app
/// and window under the selection from the same snapshot.
nonisolated struct WindowSnapshot: Sendable {
  /// One window, with what the screen-context attachment says about it.
  struct Entry: Sendable {
    let window: CaptureWindow
    /// `kCGWindowName`; readable with the Screen Recording grant a capture already has.
    let title: String?
    /// `kCGWindowOwnerName`, the fallback when the app is gone by the time it is described.
    let ownerName: String?
  }

  /// The smallest side a window needs to be offered; thinner ones are shadows and separators.
  private static let minimumSide: CGFloat = 5

  let entries: [Entry]

  var windows: [CaptureWindow] { entries.map(\.window) }

  /// On-screen windows of other apps from the normal level up to open menus, without the
  /// desktop, invisible windows, the Dock's screen-sized window and other screen overlays
  /// (``isScreenOverlay(_:pid:displays:)``). The app's own windows are left out: they are not in
  /// the frozen image either.
  static func take() -> WindowSnapshot {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let infos = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]
    else { return WindowSnapshot(entries: []) }
    let displays = activeDisplayBounds()
    let ownPID = ProcessInfo.processInfo.processIdentifier
    let highest = Int(CGWindowLevelForKey(.popUpMenuWindow))
    let dock = Int(CGWindowLevelForKey(.dockWindow))
    return WindowSnapshot(
      entries: infos.compactMap { info -> Entry? in
        guard let number = info[kCGWindowNumber as String] as? NSNumber,
          let pid = (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value, pid != ownPID,
          let layer = (info[kCGWindowLayer as String] as? NSNumber)?.intValue,
          (0...highest).contains(layer), layer != dock,
          (info[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1 > 0,
          let bounds = info[kCGWindowBounds as String] as? NSDictionary,
          let frame = CGRect(dictionaryRepresentation: bounds),
          min(frame.width, frame.height) >= minimumSide,
          !isScreenOverlay(frame, pid: pid, displays: displays)
        else { return nil }
        return Entry(
          window: CaptureWindow(
            windowID: number.uint32Value, pid: pid, quartzFrame: frame, layer: layer),
          title: info[kCGWindowName as String] as? String,
          ownerName: info[kCGWindowOwnerName as String] as? String)
      })
  }

  /// Whether a window of `frame` (Quartz) owned by `pid` is a see-through overlay of a whole
  /// display: one that covers a display exactly and belongs to a background agent (an app
  /// without a Dock icon), such as Notification Center's while a banner shows. It draws little
  /// of itself and lets the pointer through, so it is never the window a point lies over, but
  /// as the frontmost it would hide every window under it from element detection.
  private static func isScreenOverlay(_ frame: CGRect, pid: pid_t, displays: [CGRect]) -> Bool {
    let coversDisplay = displays.contains { display in
      abs(frame.minX - display.minX) < 1 && abs(frame.minY - display.minY) < 1
        && abs(frame.width - display.width) < 1 && abs(frame.height - display.height) < 1
    }
    guard coversDisplay, let app = NSRunningApplication(processIdentifier: pid) else {
      return false
    }
    return app.activationPolicy != .regular
  }

  /// Every active display's bounds in Quartz points.
  private static func activeDisplayBounds() -> [CGRect] {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetActiveDisplayList(count, &ids, &count) == .success else { return [] }
    return ids.prefix(Int(count)).map(CGDisplayBounds)
  }

  /// The app and window frontmost at `point` (Quartz): the app's localized name and the
  /// window's title, each nil when unknown.
  @MainActor func describe(at point: CGPoint) -> (app: String?, window: String?) {
    guard let entry = frontmost(at: point) else { return (nil, nil) }
    let app = NSRunningApplication(processIdentifier: entry.window.pid)?.localizedName
    return (app ?? entry.ownerName, entry.title)
  }

  /// The process of the window frontmost at `point` (Quartz), nil when none is there.
  func pid(at point: CGPoint) -> pid_t? { frontmost(at: point)?.window.pid }

  /// Frontmost captured window at `point` (Quartz), nil when none is there.
  func window(at point: CGPoint) -> CaptureWindow? { frontmost(at: point)?.window }

  /// Bounds of the window frontmost at `point` (Quartz), nil when none is there.
  func windowFrame(at point: CGPoint) -> CGRect? { frontmost(at: point)?.window.quartzFrame }

  /// What a recording of `rect` (Quartz) shows: the frontmost window whose frame it is, to the
  /// point, when it is exactly one, and the app of that window, else of the window frontmost at
  /// its centre; each nil when unknown.
  @MainActor func subject(of rect: CGRect) -> (
    windowID: CGWindowID?, app: String?, bundleID: String?
  ) {
    let exact = entries.first { entry in
      let frame = entry.window.quartzFrame
      return abs(frame.minX - rect.minX) < 1 && abs(frame.minY - rect.minY) < 1
        && abs(frame.width - rect.width) < 1 && abs(frame.height - rect.height) < 1
    }
    guard let entry = exact ?? frontmost(at: CGPoint(x: rect.midX, y: rect.midY)) else {
      return (nil, nil, nil)
    }
    let app = NSRunningApplication(processIdentifier: entry.window.pid)
    return (exact?.window.windowID, app?.localizedName ?? entry.ownerName, app?.bundleIdentifier)
  }

  private func frontmost(at point: CGPoint) -> Entry? {
    let windows = entries.map {
      ElementChain.Window(id: $0.window.windowID, pid: $0.window.pid, frame: $0.window.quartzFrame)
    }
    guard let hit = ElementChain.topmostWindow(at: point, in: windows) else { return nil }
    return entries.first { $0.window.windowID == hit.id }
  }
}
