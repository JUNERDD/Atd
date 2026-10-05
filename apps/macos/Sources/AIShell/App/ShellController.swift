import AICore
import AIRelay
import AppKit
import OSLog

/// Wires the shell together: the panel, settings and welcome guide windows, the summon flow and
/// its selection stash (``Summoner``), global hot keys, the selection toolbar and the
/// Accessibility trust it needs, files and folders opened from outside the panel, the service's
/// control stream and status item, menus and the quit guard. Its methods are what
/// ``ShellBridge`` calls for the pages.
public final class ShellController {
  private let services: ShellServices
  private let defaults: UserDefaults
  let panelHost: WebViewHost
  let panel: PanelWindowController
  private let settings: SettingsWindowController
  let onboarding: OnboardingWindowController
  let systemPanels: SystemPanels
  /// Serves the five desktop capabilities; the control stream holds it weakly.
  private let capabilities: ShellCapabilities
  let control: ControlStreamClient
  /// Security confirmations, one at a time across every surface that asks.
  let confirmations = ConfirmationPrompter()
  let artifacts: ArtifactActions
  let attachments: AttachmentImporter
  let screenshots: ScreenshotTaker
  let launchApprovals: LaunchApprovals
  /// `speech.speak` / `speech.stop`; its state reaches every page as `speech.state`.
  let speech = SpeechReader()
  /// Release builds' Sparkle updater; a waiting update reaches the panel as `update.state`.
  let updater = AppUpdater()
  let quitGuard: QuitGuard
  /// Accessibility trust; every page learns it as `accessibility.trust`.
  let trust: AccessibilityTrust
  /// Screen Recording trust; every page learns it as `screenRecording.trust`.
  let screenRecording: ScreenRecordingTrust
  let summoner: Summoner
  let toolbar: SelectionToolbarController
  /// Generated apps' windows (`userApp.*`).
  let userApps: UserAppWindows
  /// The WidgetKit extension's files and the service's list of live widgets.
  let widgets: WidgetSyncController
  private var statusItem: StatusItemController?
  private var registrar: HotKeyRegistrar?
  private var menuStatus = MenuBarStatus(availability: .connecting, running: 0, attention: 0)
  /// The first `toolbar.set` of this launch has arrived.
  private var toolbarConfigured = false

  private static let log = Logger(subsystem: "com.junerdd.ai", category: "shell")
  private static let pinnedKey = "panel.pinned"
  private static let showInDockKey = "app.showInDock"

  public init(services: ShellServices, defaults: UserDefaults = .standard) {
    self.services = services
    self.defaults = defaults
    let trust = AccessibilityTrust(defaults: defaults)
    self.trust = trust
    let screenRecording = ScreenRecordingTrust()
    self.screenRecording = screenRecording
    let bridge = ShellBridge()
    let panelHost = WebViewHost(role: .panel, fragment: nil, services: services, bridge: bridge)
    self.panelHost = panelHost
    let panel = PanelWindowController(
      host: panelHost, pinned: defaults.bool(forKey: Self.pinnedKey))
    self.panel = panel
    settings = SettingsWindowController { fragment in
      let host = WebViewHost(
        role: .settings, fragment: fragment, services: services, bridge: bridge)
      host.setState(.accessibilityTrust(.init(trusted: trust.isTrusted)))
      host.setState(.screenRecordingTrust(.init(trusted: screenRecording.isTrusted)))
      bridge.shell?.replayPins(to: host)
      return host
    }
    onboarding = OnboardingWindowController {
      let host = WebViewHost(
        role: .onboarding, fragment: "onboarding", services: services, bridge: bridge)
      host.setState(.accessibilityTrust(.init(trusted: trust.isTrusted)))
      host.setState(.screenRecordingTrust(.init(trusted: screenRecording.isTrusted)))
      return host
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
      services: services, downloads: ArtifactActions.downloadsFolder(), confirmations: confirmations
    )
    let attachments = AttachmentImporter(
      services: services, panel: panelHost, systemPanels: systemPanels)
    self.attachments = attachments
    // `screenshot.edit` reads an image that is no longer archived from the service.
    let library = CaptureLibrary(attachments: attachments) { id in
      try await services.client().resource(id: id).bytes
    }
    let screenshots = ScreenshotTaker(
      library: library, panel: panel, targeting: ElementResolver(), access: screenRecording,
      makeEditor: { AnnotationEditor() })
    self.screenshots = screenshots
    launchApprovals = LaunchApprovals(
      services: services, confirmations: confirmations, systemPanels: systemPanels)
    summoner = Summoner(
      panel: panel, panelHost: panelHost, systemPanels: systemPanels, trust: trust,
      isCapturing: { screenshots.isCapturing })
    toolbar = SelectionToolbarController(trust: trust)
    // After the panel's web view: WebKit's static data store API needs one to exist.
    userApps = UserAppWindows(
      services: services, storage: UserAppStorage(defaults: defaults), confirmations: confirmations)
    widgets = WidgetSyncController(
      services: services, files: .forMainBundle())
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
    updater.onChange = { [weak self] in
      guard let self else { return }
      panelHost.setState(.updateState(.init(version: updater.readyVersion)))
    }
    panel.onVisibilityChange = { [weak panelHost] visible in
      panelHost?.setState(.windowVisibility(.init(visible: visible)))
    }
    panel.onGaveUpKey = { [weak self] in self?.passFocusOnFromPanel() }
    panelHost.setState(.accessibilityTrust(.init(trusted: trust.isTrusted)))
    trust.onChange = { [weak self] trusted in
      self?.broadcast(.accessibilityTrust(.init(trusted: trusted)))
      self?.toolbar.update()
    }
    panelHost.setState(.screenRecordingTrust(.init(trusted: screenRecording.isTrusted)))
    screenRecording.onChange = { [weak self] trusted in
      self?.broadcast(.screenRecordingTrust(.init(trusted: trusted)))
    }
    toolbar.onAsk = { [weak self] text in self?.summon(.ask, practiceText: text) }
    toolbar.onCommand = { [weak self] id in self?.summon(.toolbarCommand(id: id)) }
    wireUserApps()
  }

  /// Starts the service connection and the app-level surfaces, then loads the panel page,
  /// which pushes the shortcut set, `selectionWanted` and the language.
  public func start(revealPanel: Bool) {
    registrar = HotKeyRegistrar { [weak self] id in self?.summon(SummonTrigger(hotKeyID: id)) }
    statusItem = StatusItemController(
      toggle: { [weak self] in self?.summon(.toggle) },
      menu: { [weak self] in AppMenus.statusMenu(self?.menuActions ?? .inert) })
    control.onConnectionState = { [weak self] state in
      self?.refreshStatus()
      if state == .connected {
        self?.attachments.serviceDidConnect()
        self?.widgets.serviceDidConnect()
      }
    }
    control.onStatus = { [weak self] _ in self?.refreshStatus() }
    refreshStatus()
    services.start()
    startWidgets()
    control.start()
    updater.start()
    trust.start()
    screenRecording.start()
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

  /// Runs the summon flow of `SummonPolicy`: capture before the panel can take focus, or take
  /// the guide's `practiceText` as the selection when its practice toolbar asked.
  func summon(_ trigger: SummonTrigger, practiceText: String? = nil) {
    summoner.summon(trigger, practiceText: practiceText)
  }

  /// Files and folders from the Finder service, a drop on the Dock icon or `open -a`: the panel
  /// shows as it is, and the items go into its composer once imported, never sent by
  /// themselves.
  func openItems(_ urls: [URL]) {
    guard !urls.isEmpty else { return }
    showPanel()
    attachments.importOpened(urls)
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

  /// A hidden panel must not keep the keyboard: the welcome guide or the settings window takes
  /// it back when open, otherwise the app steps aside for the app the user came from.
  private func passFocusOnFromPanel() {
    if !onboarding.focusIfShown(), !settings.focusIfShown() { NSApp.deactivate() }
  }

  // MARK: Entry points for the bridge

  /// A new settings window opens `commandId`'s editor or `section`; an open one keeps its page,
  /// which the page's own window message steers.
  func openSettings(commandId: String?, section: String?) {
    // The settings window would activate and order in against the capture overlays.
    guard !screenshots.isCapturing else { return }
    settings.open(
      fragment: SettingsWindowController.fragment(commandId: commandId, section: section),
      title: ShellStrings.shared.text(.windowSettingsTitle))
  }

  func closeSettings() { settings.close() }

  func applyShortcuts(_ registrations: [ShortcutRegistration], selectionWanted: Bool)
    -> [ShortcutResult]
  {
    summoner.setSelectionWanted(selectionWanted)
    return registrar?.apply(registrations) ?? []
  }

  /// `toolbar.set`. The first one of a launch with the toolbar on is when a first launch asks
  /// for Accessibility (once ever).
  func applyToolbar(_ settings: SelectionToolbarSettings) {
    toolbar.apply(settings)
    guard !toolbarConfigured else { return }
    toolbarConfigured = true
    if settings.enabled { trust.promptOnFirstLaunch() }
  }

  /// `capture('selection')` returns the stash of the last summon, never a live read.
  func captureSelection() -> CaptureResult {
    summoner.captureResult()
  }

  var isPinned: Bool { defaults.bool(forKey: Self.pinnedKey) }

  func setPinned(_ pinned: Bool) {
    defaults.set(pinned, forKey: Self.pinnedKey)
    panel.setPinned(pinned)
  }

  func setShowInDock(_ show: Bool) {
    defaults.set(show, forKey: Self.showInDockKey)
    AppPresence.setShowInDock(show)
  }

  /// `openAtLogin` is null where it is unavailable (Debug builds); `widgetsAvailable` is false
  /// outside the folders macOS indexes for widgets (``WidgetPlacement``).
  func appState() -> AppStateResult {
    AppStateResult(
      pinned: isPinned, showInDock: defaults.bool(forKey: Self.showInDockKey),
      openAtLogin: AppPresence.opensAtLogin, widgetsAvailable: widgets.isAvailable)
  }

  /// A state event for every page, so a window opened later still learns the latest value.
  func broadcast(_ event: NativeEvent) {
    panelHost.setState(event)
    settings.host?.setState(event)
    onboarding.host?.setState(event)
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
    onboarding.setTitle(ShellStrings.shared.text(.windowOnboardingTitle))
  }

  var menuActions: AppMenuActions {
    let services = services
    return AppMenuActions(
      showPanel: { [weak self] in self?.showPanel() },
      hidePanel: { [weak self] in self?.hidePanel() },
      openSettings: { [weak self] in self?.openSettings(commandId: nil, section: nil) },
      openOnboarding: { [weak self] in self?.openOnboarding() },
      replayOnboarding: { [weak self] in self?.replayOnboarding() },
      checkForUpdates: updater.isAvailable
        ? { [weak self] in self?.updater.checkForUpdates() } : nil,
      restartService: { try await services.restart() },
      showServiceLogs: { try services.revealLogs() },
      editCommand: { [weak self] command in self?.sendEditCommand(command) },
      developmentHint: { [weak self] in self?.menuStatus.developmentHint ?? false },
      selectionListening: { [weak self] in self?.toolbar.isListening },
      setSelectionListening: { [weak self] on in self?.toolbar.setListening(on) })
  }

  /// Undo and Redo go to the page of the key window, which runs them in its editor.
  private func sendEditCommand(_ command: EditCommandEvent.Command) {
    let host: WebViewHost? =
      if panel.isKey {
        panelHost
      } else if settings.isKey {
        settings.host
      } else if onboarding.isKey {
        onboarding.host
      } else {
        nil
      }
    guard let host else { return sendUserAppEditCommand(command) }
    host.send(.editCommand(.init(command: command)), scope: .document)
  }
}
