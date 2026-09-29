import AppKit

/// Entry point of the macOS shell. For now it only starts an agent (menu-bar style) app with no
/// windows; the panel, settings window, status item, relay and supervisor attach here.
@MainActor
public enum ShellApplication {
  public static func run() {
    let application = NSApplication.shared
    let delegate = ShellAppDelegate()
    application.delegate = delegate
    // Info.plist sets LSUIElement, so no Dock icon flashes at launch.
    application.setActivationPolicy(.accessory)
    withExtendedLifetime(delegate) { application.run() }
  }
}

@MainActor
final class ShellAppDelegate: NSObject, NSApplicationDelegate {
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }
}
