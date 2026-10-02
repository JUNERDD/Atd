import AppKit

/// Entry point of the macOS shell: an agent (menu bar) app with the task panel, the settings
/// window, the status item and global hot keys, running against the renderer and service of
/// this build configuration (``ShellServices/forThisBuild(environment:home:)``). The services
/// are made once the application has launched.
public enum ShellApplication {
  public static func run(
    makeServices: @escaping @MainActor () -> ShellServices = { .forThisBuild() }
  ) {
    SingleInstance.ensureOnlyInstance()
    let application = NSApplication.shared
    let delegate = ShellAppDelegate(makeServices: makeServices)
    application.delegate = delegate
    // Info.plist sets LSUIElement, so no Dock icon flashes at launch.
    application.setActivationPolicy(.accessory)
    withExtendedLifetime(delegate) { application.run() }
  }
}

final class ShellAppDelegate: NSObject, NSApplicationDelegate {
  private let makeServices: @MainActor () -> ShellServices
  private var controller: ShellController?
  private var launchedAtLogin = false

  init(makeServices: @escaping @MainActor () -> ShellServices) {
    self.makeServices = makeServices
  }

  func applicationWillFinishLaunching(_ notification: Notification) {
    // The open-application Apple event is current only while launching.
    launchedAtLogin = AppPresence.launchedAtLogin()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    let controller = ShellController(services: makeServices())
    self.controller = controller
    SingleInstance.observeLaterLaunches { [weak controller] in controller?.summon(.toggle) }
    // Opened at login, the app waits in the menu bar instead of showing the panel.
    controller.start(revealPanel: !launchedAtLogin)
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    controller?.quitGuard.shouldTerminate() ?? .terminateNow
  }

  /// A click on the Dock icon (when shown) or a reopen from Finder shows the panel.
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool
  {
    controller?.showPanel()
    return false
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }
}
