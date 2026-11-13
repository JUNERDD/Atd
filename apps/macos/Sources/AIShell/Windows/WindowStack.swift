import AppKit
import CoreGraphics

/// Where a shell window sits among every app's windows, read from the window server: AppKit
/// only knows Atd's own windows, yet whether bringing one forward would jump it over the app the
/// person is using depends on the others. Read each time, never cached.
///
/// A level change orders a window in front of every peer at its new level, so this is also what
/// decides whether the task panel may take the floating level (``PanelWindowController``).
enum WindowStack {
  /// Whether a window of another app overlaps `window` from above, at its level or up to the
  /// floating level: ordering `window` forward or floating it would bring it over that window.
  /// The menu bar, the Dock and other system levels stay above either way, so they never count.
  static func isCovered(_ window: NSWindow) -> Bool {
    guard let frame = list(.optionIncludingWindow, relativeTo: window).first?.frame else {
      return false
    }
    let own = ProcessInfo.processInfo.processIdentifier
    let lowest = window.level.rawValue
    let levels = lowest...max(lowest, NSWindow.Level.floating.rawValue)
    return list(.optionOnScreenAboveWindow, relativeTo: window).contains { other in
      other.pid != own && levels.contains(other.layer) && other.alpha > 0
        && other.frame.intersects(frame)
    }
  }

  /// The on-screen windows stacked above `window` at its own level, of any app, nearest first:
  /// what ``orderIn(_:below:)`` puts it back under.
  static func windowsAbove(atLevelOf window: NSWindow) -> [CGWindowID] {
    let level = window.level.rawValue
    return list(.optionOnScreenAboveWindow, relativeTo: window)
      .filter { $0.layer == level }.map(\.id).reversed()
  }

  /// Orders `window` in directly under the nearest of `windows` still on screen, or in front of
  /// its level when none is: where it stood when they were read, without the keyboard. The
  /// window server orders relative to any window, another app's included.
  static func orderIn(_ window: NSWindow, below windows: [CGWindowID]) {
    let onScreen = Set(list(.optionOnScreenOnly, relativeTo: nil).map(\.id))
    if let anchor = windows.first(where: onScreen.contains) {
      window.order(.below, relativeTo: Int(anchor))
    } else {
      window.orderFrontRegardless()
    }
  }

  private struct Entry {
    let id: CGWindowID
    let pid: pid_t
    let layer: Int
    let alpha: Double
    let frame: CGRect
  }

  /// The window server's list, front to back; relative to `window` unless it is nil. A window
  /// the server has not ordered in yet has no number, and nothing is listed relative to it.
  private static func list(_ option: CGWindowListOption, relativeTo window: NSWindow?) -> [Entry] {
    var relative = kCGNullWindowID
    if let window {
      guard window.windowNumber > 0 else { return [] }
      relative = CGWindowID(window.windowNumber)
    }
    let infos = CGWindowListCopyWindowInfo(option, relative) as? [[String: Any]] ?? []
    return infos.compactMap { info in
      guard let id = (info[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
        let pid = (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,
        let layer = (info[kCGWindowLayer as String] as? NSNumber)?.intValue,
        let bounds = info[kCGWindowBounds as String] as? NSDictionary,
        let frame = CGRect(dictionaryRepresentation: bounds)
      else { return nil }
      let alpha = (info[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1
      return Entry(id: id, pid: pid, layer: layer, alpha: alpha, frame: frame)
    }
  }
}
