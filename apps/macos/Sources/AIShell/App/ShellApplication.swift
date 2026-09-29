import AppKit

/// Entry point of the macOS shell: an agent (menu bar) app with the task panel, the settings
/// window, the status item and global hot keys. `makeServices` supplies what lives outside
/// AIShell (the relay, the service supervisor); it runs once the application has launched.
/// `didStart` then receives the controller, whose ``ShellController/capabilityHandler`` the
/// relay's control stream serves `capability.request` frames with.
@MainActor
public enum ShellApplication {
  public static func run(
    makeServices: @escaping @MainActor () -> ShellServices,
    didStart: @escaping @MainActor (ShellController) -> Void = { _ in }
  ) {
    SingleInstance.ensureOnlyInstance()
    let application = NSApplication.shared
    let delegate = ShellAppDelegate(makeServices: makeServices, didStart: didStart)
    application.delegate = delegate
    // Info.plist sets LSUIElement, so no Dock icon flashes at launch.
    application.setActivationPolicy(.accessory)
    withExtendedLifetime(delegate) { application.run() }
  }

  /// Runs without a relay: every page request fails and the service reads as unavailable.
  /// The App target uses this until integration supplies AIRelay.
  public static func run() {
    run { UnconnectedServices().services }
  }
}

@MainActor
final class ShellAppDelegate: NSObject, NSApplicationDelegate {
  private let makeServices: @MainActor () -> ShellServices
  private let didStart: @MainActor (ShellController) -> Void
  private var controller: ShellController?
  private var launchedAtLogin = false

  init(
    makeServices: @escaping @MainActor () -> ShellServices,
    didStart: @escaping @MainActor (ShellController) -> Void
  ) {
    self.makeServices = makeServices
    self.didStart = didStart
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
    didStart(controller)
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
