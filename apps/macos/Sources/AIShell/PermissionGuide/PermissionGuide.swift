import AICore
import AppKit

/// A privacy permission the guide can lead to: its Privacy & Security page and its name there.
enum PermissionPane {
  case accessibility
  case screenRecording

  var settingsURL: URL? {
    switch self {
    case .accessibility:
      URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
    case .screenRecording:
      URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
    }
  }

  var nameKey: ShellStringKey {
    switch self {
    case .accessibility: .permissionGuideAccessibility
    case .screenRecording: .permissionGuideScreenRecording
    }
  }
}

/// The drag-to-allow guide for a privacy permission: it opens the permission's Privacy & Security
/// page and docks ``PermissionGuidePanel`` under System Settings' window, following it as it
/// moves. The panel shows this app's card, which the user drags into the page's list. macOS
/// grants these permissions only there, so the guide shows the way and never answers for the
/// system.
///
/// The panel appears only once System Settings is in front with its window on screen, and steps
/// away whenever another app comes forward (``SettingsWindowTracker``). One guide runs at a time:
/// opening it for another permission replaces it. It ends from the panel's close button, when
/// System Settings quits, and through ``finish(_:)`` once the permission is held.
final class PermissionGuide {
  static let shared = PermissionGuide()

  private let tracker = SettingsWindowTracker()
  private var panel: PermissionGuidePanel?
  private var pane: PermissionPane?
  /// The Atd window whose row opened the guide: the welcome guide or the settings window.
  private weak var asker: NSWindow?

  private init() {
    tracker.onChange = { [weak self] frame in self?.panel?.place(under: frame) }
    tracker.onQuit = { [weak self] in self?.end(returning: false) }
  }

  func open(_ pane: PermissionPane) {
    end(returning: false)
    guard let url = pane.settingsURL else { return }
    let appURL = Bundle.main.bundleURL
    // The bundle's file name, as Finder and System Settings' list name it.
    let panel = PermissionGuidePanel(
      pane: pane, appURL: appURL, appName: appURL.deletingPathExtension().lastPathComponent)
    panel.onClose = { [weak self] in self?.end(returning: true) }
    self.panel = panel
    self.pane = pane
    asker = NSApp.keyWindow
    NSWorkspace.shared.open(url)
    tracker.start()
  }

  /// The permission is held: ends its guide, and returns to Atd when the user is still in System
  /// Settings, so the welcome guide or settings row that asked shows the granted state.
  func finish(_ pane: PermissionPane) {
    guard self.pane == pane else { return }
    end(
      returning: NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        == SettingsWindowTracker.bundleIdentifier)
  }

  private func end(returning: Bool) {
    guard let panel else { return }
    tracker.stop()
    panel.close()
    self.panel = nil
    pane = nil
    guard returning else { return }
    NSApp.activate()
    // Since macOS 14 activation is cooperative and the app now in front may refuse it; ordering
    // the window front regardless still lifts it above that app's windows, without taking focus.
    if let asker, asker.isVisible {
      asker.orderFrontRegardless()
      asker.makeKeyAndOrderFront(nil)
    }
  }
}
