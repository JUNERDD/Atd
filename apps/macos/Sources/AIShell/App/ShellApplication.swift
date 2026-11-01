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
    SupportDiagnostics.shared.start()
    withExtendedLifetime(delegate) { application.run() }
  }
}

final class ShellAppDelegate: NSObject, NSApplicationDelegate {
  private let makeServices: @MainActor () -> ShellServices
  private var controller: ShellController?
  private var finderService: FinderService?
  private var launchedAtLogin = false
  private var earlyQuitPending = false
  /// Files opened while launching, before the controller exists.
  private var openedBeforeLaunch: [URL] = []
  /// Widget taps and Finder Sync links that launched the app: on a cold start the URL arrives
  /// before `applicationDidFinishLaunching` (T1b).
  private var linksBeforeLaunch: [URL] = []
  /// Clicks and actions on notifications, held until the controller can act on them.
  private let notifications = NotificationResponder()

  init(makeServices: @escaping @MainActor () -> ShellServices) {
    self.makeServices = makeServices
  }

  func applicationWillFinishLaunching(_ notification: Notification) {
    // The open-application Apple event is current only while launching.
    launchedAtLogin = AppPresence.launchedAtLogin()
    // Before launch finishes, so a notification click that launched the app reaches it.
    notifications.install()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    guard !earlyQuitPending else { return }
    // Before any window or web view exists, so the first frame is already in the user's scheme.
    AppAppearance.shared.restore()
    let controller = ShellController(services: makeServices())
    self.controller = controller
    SingleInstance.observeLaterLaunches { [weak controller] in controller?.summon(.toggle) }
    let finderService = FinderService { [weak controller] urls in controller?.openItems(urls) }
    self.finderService = finderService
    NSApp.servicesProvider = finderService
    Task { await FinderExtension.enableIfUndecided() }
    // Opened at login, the app waits in the menu bar instead of showing the panel; opened with
    // files, it shows them; opened by a widget or a notification, it shows what that asks for.
    controller.start(
      revealPanel: !launchedAtLogin && openedBeforeLaunch.isEmpty && linksBeforeLaunch.isEmpty
        && !notifications.hasHeldResponses)
    controller.openItems(openedBeforeLaunch)
    openedBeforeLaunch = []
    for link in linksBeforeLaunch { openLink(link, in: controller) }
    linksBeforeLaunch = []
    notifications.deliver { [weak controller] in controller?.respondToNotification($0) }
  }

  /// Files or folders dropped on the Dock icon or opened with `open -a`, through the same import
  /// as the Finder service. While launching they arrive before the controller exists.
  ///
  /// Any other URL is the Finder Sync extension's link (``FinderHandoff``) or a widget link
  /// (`atd://` or `atd-dev://`), which only opens an app window after ``WidgetLink`` accepted it.
  func application(_ application: NSApplication, open urls: [URL]) {
    let files = urls.filter(\.isFileURL)
    let links = urls.filter { !$0.isFileURL }
    guard let controller else {
      openedBeforeLaunch += files
      linksBeforeLaunch += links
      return
    }
    controller.openItems(files)
    for link in links { openLink(link, in: controller) }
  }

  private func openLink(_ link: URL, in controller: ShellController) {
    if finderService?.openHandoff(link) != true { controller.openWidgetLink(link) }
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    if let controller { return controller.quitGuard.shouldTerminate() }
    guard SupportDiagnostics.enabled, !earlyQuitPending else { return .terminateNow }
    earlyQuitPending = true
    Task {
      await SupportDiagnostics.shared.stopForQuit()
      sender.reply(toApplicationShouldTerminate: true)
    }
    return .terminateLater
  }

  func applicationDidResignActive(_ notification: Notification) {
    controller?.cancelShortcutRecordings()
  }

  /// A Dock click or Finder reopen returns to the welcome guide or the settings window while one
  /// is open.
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool
  {
    controller?.reopen()
    return false
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }
}
