import AICore
import AIRelay
import AppKit
import OSLog

/// Wires the shell together: the panel and settings windows, the summon flow, global hot keys,
/// the selection stash, the service's control stream and status item, menus and the quit
/// guard. Its methods are what ``ShellBridge`` calls for the pages.
public final class ShellController {
  private let services: ShellServices
  private let defaults: UserDefaults
  let panelHost: WebViewHost
  let panel: PanelWindowController
  private let settings: SettingsWindowController
  private let systemPanels: SystemPanels
  /// Serves the five desktop capabilities; the control stream holds it weakly.
  private let capabilities: ShellCapabilities
  private let control: ControlStreamClient
  /// Security confirmations, one at a time across every surface that asks.
  let confirmations = ConfirmationPrompter()
  let artifacts: ArtifactActions
  let attachments: AttachmentImporter
  private let screenshots: ScreenshotTaker
  let launchApprovals: LaunchApprovals
  /// `speech.speak` / `speech.stop`; its state reaches every page as `speech.state`.
  let speech = SpeechReader()
  let quitGuard: QuitGuard
  private var statusItem: StatusItemController?
  private var registrar: HotKeyRegistrar?
  private var menuStatus = MenuBarStatus(availability: .connecting, running: 0, attention: 0)

  private var selectionWanted = false
  private var stash: CapturedText?
  private var summoning = false
  private var trustRequested = false

  private static let log = Logger(subsystem: "com.junerdd.ai", category: "shell")
  private static let pinnedKey = "panel.pinned"
  private static let showInDockKey = "app.showInDock"

  public init(services: ShellServices, defaults: UserDefaults = .standard) {
    self.services = services
    self.defaults = defaults
    let bridge = ShellBridge()
    let panelHost = WebViewHost(role: .panel, fragment: nil, services: services, bridge: bridge)
    self.panelHost = panelHost
    let panel = PanelWindowController(
      host: panelHost, pinned: defaults.bool(forKey: Self.pinnedKey))
    self.panel = panel
    settings = SettingsWindowController { fragment in
      WebViewHost(role: .settings, fragment: fragment, services: services, bridge: bridge)
    }
    let systemPanels = SystemPanels(
      lowerPanel: { panel.lowerForSystemPanel() }, restorePanel: { panel.restoreLevel($0) })
    self.systemPanels = systemPanels
    let capabilities = ShellCapabilities(
      services: services, panelVisible: { panel.isVisible }, systemPanels: systemPanels)
    self.capabilities = capabilities
    let control = ControlStreamClient(link: services.link, capabilities: capabilities)
    self.control = control
    artifacts = ArtifactActions(
      services: services, downloads: Self.downloadsFolder(), confirmations: confirmations)
    let attachments = AttachmentImporter(
      services: services, panel: panelHost, systemPanels: systemPanels)
    self.attachments = attachments
    // `screenshot.edit` reads an image that is no longer archived from the service.
    let library = CaptureLibrary(attachments: attachments) { id in
      try await services.client().resource(id: id).bytes
    }
    let screenshots = ScreenshotTaker(
      library: library, panel: panel, targeting: ElementResolver(),
      makeEditor: { AnnotationEditor() })
    self.screenshots = screenshots
    launchApprovals = LaunchApprovals(
      services: services, confirmations: confirmations, systemPanels: systemPanels)
    // A quit ends a capture session first: `activeRuns` runs before the quit alert could open
    // beneath the overlays, `hideWindows` on an unattended quit that skips it.
    quitGuard = QuitGuard(
      activeRuns: {
        screenshots.cancel()
        return await services.link.activeRunsForQuitGuard()
      },
      stopService: {
        control.stop()
        await services.stopForQuit()
      },
      hideWindows: {
        screenshots.cancel()
        for window in NSApp.windows { window.orderOut(nil) }
      })
    bridge.shell = self
    speech.onChange = { [weak self] speaking in
      self?.broadcast(.speechState(.init(speaking: speaking)))
    }
    panel.onVisibilityChange = { [weak panelHost] visible in
      panelHost?.setState(.windowVisibility(.init(visible: visible)))
    }
    panel.onGaveUpKey = { [weak self] in self?.passFocusOnFromPanel() }
  }

  /// Starts the service connection and the app-level surfaces, then loads the panel page,
  /// which pushes the shortcut set, `selectionWanted` and the language.
  public func start(revealPanel: Bool) {
    registrar = HotKeyRegistrar { [weak self] id in self?.summon(SummonTrigger(hotKeyID: id)) }
    statusItem = StatusItemController(
      toggle: { [weak self] in self?.summon(.toggle) },
      menu: { [weak self] in AppMenus.statusMenu(self?.menuActions ?? .inert) })
    control.onConnectionState = { [weak self] _ in self?.refreshStatus() }
    control.onStatus = { [weak self] _ in self?.refreshStatus() }
    refreshStatus()
    services.start()
    control.start()
    AppPresence.setShowInDock(defaults.bool(forKey: Self.showInDockKey))
    applyLanguage()
    NotificationCenter.default.addObserver(
      forName: ShellStrings.didChange, object: nil, queue: .main
    ) { [weak self] _ in MainActor.assumeIsolated { self?.applyLanguage() } }
    panelHost.setState(.windowVisibility(.init(visible: false)))
    panelHost.load()
    if revealPanel { summon(.toggle) }
  }

  // MARK: Summons

  /// Runs the summon flow of `SummonPolicy`: capture before the panel can take focus.
  func summon(_ trigger: SummonTrigger) {
    // A summon during a capture session would show the panel against the overlays.
    guard !summoning, !screenshots.isCapturing else { return }
    let steps = SummonPolicy.steps(
      for: trigger,
      in: SummonContext(
        panelIsKey: panel.isKey, filePanelOpen: systemPanels.isOpen,
        selectionWanted: selectionWanted))
    guard !steps.isEmpty else { return }
    summoning = true
    Task {
      defer { summoning = false }
      for step in steps {
        switch step {
        case .hidePanel: panel.hide()
        case .captureSelection: stash = TextCapture.stash(await readSelection(), at: .now)
        case .clearSelection: stash = nil
        case .showPanel:
          panel.dockAtCursor()
          panel.show()
        case .deliverCommand(let id): panelHost.send(.shortcutCommand(.init(id: id)))
        }
      }
    }
  }

  /// The frontmost app's selection, asking for Accessibility once per launch when needed.
  private func readSelection() async -> String? {
    guard SelectionReader.isTrusted else {
      if !trustRequested {
        trustRequested = true
        SelectionReader.requestTrust()
      }
      return nil
    }
    let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier
    return await SelectionReader.readBounded(frontmostPID: pid)
  }

  /// Shows the panel where it is, as Show task panel and the page's `window.show` do.
  func showPanel() {
    guard !systemPanels.isOpen, !screenshots.isCapturing else { return }
    panel.show()
  }

  func hidePanel() {
    guard !systemPanels.isOpen, !screenshots.isCapturing else { return }
    panel.hide()
  }

  /// A hidden panel must not keep the keyboard: the settings window takes it back when open,
  /// otherwise the app steps aside for the app the user came from.
  private func passFocusOnFromPanel() {
    if settings.isOpen, let host = settings.host, let window = host.container.window,
      window.isVisible, !window.isMiniaturized
    {
      window.makeKeyAndOrderFront(nil)
    } else {
      NSApp.deactivate()
    }
  }

  // MARK: Entry points for the bridge

  /// A new settings window opens `commandId`'s editor (`#settings?commandId=…`); an open one
  /// keeps its page, which the page's own window message steers.
  func openSettings(commandId: String?) {
    // The settings window would activate and order in against the capture overlays.
    guard !screenshots.isCapturing else { return }
    var fragment = "settings"
    if let commandId {
      var query = URLComponents()
      query.queryItems = [URLQueryItem(name: "commandId", value: commandId)]
      // `URLSearchParams` reads `+` as a space.
      let encoded = query.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
      fragment += "?" + (encoded ?? "")
    }
    settings.open(fragment: fragment, title: ShellStrings.shared.text(.windowSettingsTitle))
  }

  func closeSettings() { settings.close() }

  func applyShortcuts(_ registrations: [ShortcutRegistration], selectionWanted: Bool)
    -> [ShortcutResult]
  {
    self.selectionWanted = selectionWanted
    if !selectionWanted { stash = nil }
    return registrar?.apply(registrations) ?? []
  }

  /// `capture('selection')` returns the stash of the last summon, never a live read.
  func captureSelection() -> CaptureResult {
    TextCapture.captureResult(stash: stash, trusted: SelectionReader.isTrusted)
  }

  /// `screenshot.capture`, which hides the panel while it runs. A summon still moving the panel
  /// would fight over it, and an open file dialog or confirmation would sit beneath the
  /// overlays, so the call is refused then.
  func captureScreenshot() async throws(BridgeError) -> ScreenshotCaptureResult {
    try checkScreenshotAllowed()
    return try await screenshots.capture()
  }

  /// `screenshot.edit`, under the same conditions as a capture.
  func editScreenshot(resourceId: String) async throws(BridgeError) -> ScreenshotEditResult {
    try checkScreenshotAllowed()
    return try await screenshots.edit(resourceId: resourceId)
  }

  private func checkScreenshotAllowed() throws(BridgeError) {
    guard !summoning else { throw BridgeError("The panel is still opening; try again.") }
    guard !systemPanels.isOpen, !confirmations.isShowing else {
      throw BridgeError("Close the open dialog before taking a screenshot.")
    }
  }

  /// A capture session covers every display; calls that would open a dialog wait for it.
  var isCapturingScreenshot: Bool { screenshots.isCapturing }

  func setPinned(_ pinned: Bool) {
    defaults.set(pinned, forKey: Self.pinnedKey)
    panel.setPinned(pinned)
  }

  func setShowInDock(_ show: Bool) {
    defaults.set(show, forKey: Self.showInDockKey)
    AppPresence.setShowInDock(show)
  }

  /// `openAtLogin` is null where it is unavailable (Debug builds).
  func appState() -> AppStateResult {
    AppStateResult(
      pinned: defaults.bool(forKey: Self.pinnedKey),
      showInDock: defaults.bool(forKey: Self.showInDockKey), openAtLogin: AppPresence.opensAtLogin)
  }

  /// A state event for every page, so a window opened later still learns the latest value.
  private func broadcast(_ event: NativeEvent) {
    panelHost.setState(event)
    settings.host?.setState(event)
  }

  // MARK: App surfaces

  /// The status item follows the control stream: reachability, then the `status` counts.
  private func refreshStatus() {
    let availability: ServiceAvailability =
      switch control.state {
      case .connecting: .connecting
      case .connected: .available
      case .reconnecting: .unavailable(development: false)
      case .disconnected:
        .unavailable(development: control.unavailable == .developmentServiceNotRunning)
      }
    menuStatus = MenuBarStatus(
      availability: availability, running: control.status?.running ?? 0,
      attention: control.status?.attention ?? 0)
    statusItem?.update(menuStatus)
    #if DEBUG
      Self.log.info(
        "menu bar \(self.menuStatus.state.rawValue, privacy: .public) running \(self.menuStatus.running) attention \(self.menuStatus.attention)"
      )
    #endif
  }

  private func applyLanguage() {
    NSApp.mainMenu = AppMenus.mainMenu(menuActions)
    panel.setTitle(ShellStrings.shared.text(.windowPanelTitle))
    settings.setTitle(ShellStrings.shared.text(.windowSettingsTitle))
  }

  var menuActions: AppMenuActions {
    let services = services
    return AppMenuActions(
      showPanel: { [weak self] in self?.showPanel() },
      hidePanel: { [weak self] in self?.hidePanel() },
      openSettings: { [weak self] in self?.openSettings(commandId: nil) },
      restartService: { try await services.restart() },
      showServiceLogs: { try services.revealLogs() },
      editCommand: { [weak self] command in self?.sendEditCommand(command) },
      developmentHint: { [weak self] in self?.menuStatus.developmentHint ?? false })
  }

  /// Undo and Redo go to the page of the key window, which runs them in its editor.
  private func sendEditCommand(_ command: EditCommandEvent.Command) {
    let host = panel.isKey ? panelHost : settings.isKey ? settings.host : nil
    host?.send(.editCommand(.init(command: command)), scope: .document)
  }

  private static func downloadsFolder() -> URL {
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
    let base = support.first ?? URL(filePath: NSTemporaryDirectory())
    return base.appending(path: Bundle.main.bundleIdentifier ?? "com.junerdd.ai")
      .appending(path: "downloads")
  }
}

extension AppMenuActions {
  /// Actions of a controller that is gone; the menu still builds.
  static var inert: AppMenuActions {
    AppMenuActions(
      showPanel: {}, hidePanel: {}, openSettings: {}, restartService: {}, showServiceLogs: {},
      editCommand: { _ in }, developmentHint: { false })
  }
}
