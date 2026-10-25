import AICore
import AppKit
import MCP

/// The displays as the browser's window space sees them, and what the person's own opening of the
/// browser does with windows a run parked.
extension ManagedChromes {
  /// Every display's frame, and the part of each below the menu bar and above the Dock, in window
  /// space (the origin at the primary display's top-left corner, y down). `NSScreen.screens`
  /// lists the primary display first.
  static func displays() -> (frames: [BrowserWindowRect], visible: [BrowserWindowRect]) {
    let screens = NSScreen.screens
    guard let primary = screens.first else { return ([], []) }
    let height = primary.frame.height
    return (
      screens.map { BrowserWindowPlacement.windowSpace($0.frame, primaryHeight: height) },
      screens.map { BrowserWindowPlacement.windowSpace($0.visibleFrame, primaryHeight: height) }
    )
  }

  /// Puts the browser's parked windows back on the display the person is on, before the browser
  /// is brought forward for them ("Open browser", "Sign in again"). Best effort: a browser whose
  /// worker cannot answer is opened as it is, since the person asked for it and a failure here
  /// must not keep them from it.
  func restoreParkedWindows(_ instance: ManagedChromeInstance) async {
    guard let workers else { return }
    let displays = Self.displays()
    let pointer = NSEvent.mouseLocation
    let index = NSScreen.screens.firstIndex { NSMouseInRect(pointer, $0.frame, false) } ?? 0
    guard displays.visible.indices.contains(index) else { return }
    let frame = BrowserWindowPlacement.normal(on: displays.visible[index])
    do throws(ComputerFailure) {
      let (reply, _) = try await workers.invoke(
        instance, "restore_windows",
        ["displays": .array(displays.frames.map(\.value)), "frame": frame.value],
        timeout: .seconds(10), writes: true)
      let moved = try reply.checked("restore_windows").moved ?? 0
      if moved > 0 {
        Self.log.notice(
          "Brought \(moved, privacy: .public) parked browser window(s) back on a display.")
      }
    } catch {
      Self.log.error(
        "Parked browser windows were not brought back: \(error.message, privacy: .public)")
    }
  }
}
