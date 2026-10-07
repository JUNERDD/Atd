import AppKit
import CoreGraphics

/// Where System Settings' window is, for the permission guide to dock to. It reads the window
/// server's list, which needs no permission (only window titles would, and none is read), about
/// 30 times a second while the guide is open, so the panel keeps up while the window moves.
///
/// ``onChange`` reports the window's frame in AppKit screen coordinates while System Settings is
/// the active app and its window is on screen, and nil otherwise: before it has opened, while
/// another app (Atd's own guide among them) is in front, and while its window is minimized or on
/// another Space. ``onQuit`` reports System Settings quitting.
final class SettingsWindowTracker {
  nonisolated static let bundleIdentifier = "com.apple.systempreferences"

  var onChange: ((CGRect?) -> Void)?
  var onQuit: (() -> Void)?

  private var timer: Timer?
  private var termination: NSObjectProtocol?
  private var frame: CGRect?
  private var reported = false

  func start() {
    stop()
    termination = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main
    ) { [weak self] note in
      let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
      guard app?.bundleIdentifier == Self.bundleIdentifier else { return }
      MainActor.assumeIsolated { self?.onQuit?() }
    }
    let timer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.tick() }
    }
    // Common modes, so the panel follows while a menu or a live resize runs the loop.
    RunLoop.main.add(timer, forMode: .common)
    self.timer = timer
    tick()
  }

  func stop() {
    timer?.invalidate()
    timer = nil
    if let termination { NSWorkspace.shared.notificationCenter.removeObserver(termination) }
    termination = nil
    frame = nil
    reported = false
  }

  private func tick() {
    let next = Self.activeWindowFrame()
    guard !reported || next != frame else { return }
    reported = true
    frame = next
    onChange?(next)
  }

  /// The frame of System Settings' main window while it is the active app: its largest on-screen
  /// window at the normal level, so a sheet or popover over it is not taken for it.
  private static func activeWindowFrame() -> CGRect? {
    guard let app = NSWorkspace.shared.frontmostApplication,
      app.bundleIdentifier == bundleIdentifier,
      let list = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
    else { return nil }
    let bounds = list.compactMap { info -> CGRect? in
      guard info[kCGWindowOwnerPID as String] as? pid_t == app.processIdentifier,
        info[kCGWindowLayer as String] as? Int == 0,
        let dictionary = info[kCGWindowBounds as String] as? NSDictionary,
        let rect = CGRect(dictionaryRepresentation: dictionary)
      else { return nil }
      return rect
    }
    guard let largest = bounds.max(by: { $0.width * $0.height < $1.width * $1.height }) else {
      return nil
    }
    // The window server measures from the primary display's top-left corner; AppKit from its
    // bottom-left.
    let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
    return CGRect(
      x: largest.minX, y: primaryHeight - largest.maxY, width: largest.width,
      height: largest.height)
  }
}
