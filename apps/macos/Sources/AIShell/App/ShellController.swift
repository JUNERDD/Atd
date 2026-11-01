import AICore
import AIRelay
import AppKit

/// Wires the shell together: the panel, settings and welcome guide windows, the summon flow and
/// its selection stash (``Summoner``), global hot keys, the selection toolbar and the
/// Accessibility trust it needs, the mini panel, files and folders opened from outside the panel,
/// the service's control stream and status item, menus and the quit guard. Its methods are what
/// ``ShellBridge`` calls for the pages.
public final class ShellController {
  let services: ShellServices
  private let defaults: UserDefaults
  let presence: AppPresence
  let panelHost: WebViewHost
  var shownComputerTaskId: String?
  let panel: PanelWindowController
  let settings: SettingsWindowController
  let onboarding: OnboardingWindowController
  var launchPresentation = LaunchPresentation(revealPanel: false)
  let systemPanels: SystemPanels
  /// Every native writer's admission to the screen, input, clipboard and computer targets.
  let deviceArbiter: DeviceArbiter
  /// The computer host lock, journal and generation, held from ``start(revealPanel:)`` to quit.
  let computerHost: ComputerHostSession
  /// The computer host's coordinator: requests, engines, targets, the live pointer.
  let computer: ComputerCoordinator
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
  /// Release builds' Sparkle updater; its download and a waiting update reach the panel as
  /// `update.state`.
  let updater = AppUpdater()
  let quitGuard: QuitGuard
  /// Accessibility trust; every page learns it as `accessibility.trust`.
  let trust: AccessibilityTrust
  /// Screen Recording trust; every page learns it as `screenRecording.trust`.
  let screenRecording: ScreenRecordingTrust
  let summoner: Summoner
  let toolbar: SelectionToolbarController
  /// The commands whose options the shell offers (`commandOptions.set`).
  var commandOptions = CommandOptionsCatalog()
  /// The island a command that writes back without the panel shows (`commandProgress.*`).
  lazy var commandProgress = CommandProgressController(
    panelHost, toolbar: toolbar, returnFocus: { [weak self] in self?.returnFocus(to: $0) },
    attachments: composeAttachments(),
    answerWriter: { [weak self] answer, mode in
      await self?.writeAnswer(answer, mode: mode)
        ?? AnswerWriteOutcome(result: .notOk(.init(reason: .failed)), app: "")
    }, arbiter: deviceArbiter)
  /// Command shortcuts' presses and releases, which hold for a command's options.
  lazy var shortcutHolds = makeShortcutHolds()
  /// The edge-docked quick entry, which every page follows as `miniPanel.state`.
  let miniPanel: MiniPanelController
  lazy var taskActivity = ShellTaskActivity(shell: self)
  /// Generated apps' windows (`userApp.*`).
  let userApps: UserAppWindows
  /// Generative views' windows (`view.open`).
  let viewWindows: ViewWindows
  /// The WidgetKit extension's files and the service's list of live widgets.
  let widgets: WidgetSyncController
  /// Automation and task notifications; nil outside an app bundle.
  let notifications: ShellNotifications?
  let systemActivity: SystemActivityReporter
  /// The menu bar item and what it shows, kept current by ``refreshStatus()``.
  var statusItem: StatusItemController?
  private(set) var registrar: HotKeyRegistrar?
  var menuStatus = MenuBarStatus(availability: .connecting, running: 0, attention: 0)
  /// The first `toolbar.set` of this launch has arrived.
  private var toolbarConfigured = false

  private static let pinnedKey = "panel.pinned"

  public init(services: ShellServices, defaults: UserDefaults = .standard) {
    self.services = services
    self.defaults = defaults
    presence = AppPresence(defaults: defaults)
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
      bridge.shell?.replayComputer(to: host)
      bridge.shell?.replayMiniPanel(to: host)
      return host
    }
    onboarding = OnboardingWindowController {
      let host = WebViewHost(
        role: .onboarding, fragment: "onboarding", services: services, bridge: bridge)
      host.setState(.accessibilityTrust(.init(trusted: trust.isTrusted)))
      host.setState(.screenRecordingTrust(.init(trusted: screenRecording.isTrusted)))
      bridge.shell?.replayMiniPanel(to: host)
      return host
    }
    viewWindows = Self.makeViewWindows(services: services, bridge: bridge)
    let arbiter = DeviceArbiter()
    deviceArbiter = arbiter
    let computerHost = ComputerHostSession(lock: ComputerHostLock(), arbiter: arbiter)
    self.computerHost = computerHost
    let computer = Self.makeComputer(host: computerHost, arbiter: arbiter, defaults: defaults)
    self.computer = computer
    let systemPanels = SystemPanels(
      lowerPanel: { panel.lowerForSystemPanel() }, restorePanel: { panel.restoreLevel($0) },
      arbiter: arbiter)
    self.systemPanels = systemPanels
    let capabilities = ShellCapabilities(
      services: services, panelVisible: { panel.isVisible }, systemPanels: systemPanels,
      arbiter: arbiter)
    self.capabilities = capabilities
    let control = ControlStreamClient(link: services.link, capabilities: capabilities)
    self.control = control
    artifacts = ArtifactActions(
      services: services, downloads: ArtifactActions.downloadsFolder(),
      confirmations: confirmations, arbiter: arbiter)
    let attachments = AttachmentImporter(
      services: services, panel: panelHost, systemPanels: systemPanels)
    self.attachments = attachments
    // `screenshot.edit` reads an image that is no longer archived from the service.
    let library = CaptureLibrary(attachments: attachments) { id in
      try await services.client().resource(id: id).bytes
    }
    let screenshots = ScreenshotTaker(
      library: library, panel: panel, targeting: ElementResolver(), access: screenRecording,
      makeEditor: { AnnotationEditor() }, arbiter: arbiter)
    self.screenshots = screenshots
    launchApprovals = LaunchApprovals(
      services: services, confirmations: confirmations, systemPanels: systemPanels)
    summoner = Summoner(
      panel: panel, panelHost: panelHost, systemPanels: systemPanels, trust: trust,
      isCapturing: { screenshots.isCapturing }, arbiter: arbiter)
    toolbar = SelectionToolbarController(trust: trust)
    miniPanel = MiniPanelController(defaults: defaults)
    // After the panel's web view: WebKit's static data store API needs one to exist.
    userApps = UserAppWindows(
      services: services, storage: UserAppStorage(defaults: defaults), confirmations: confirmations,
      arbiter: arbiter)
    widgets = WidgetSyncController(
      services: services, files: .forMainBundle())
    notifications = Self.makeNotifications(services: services, defaults: defaults, panel: panel)
    systemActivity = Self.makeSystemActivity(services: services)
    // A quit ends a capture session first: `activeRuns` runs before the quit alert could open
    // beneath the overlays, `hideWindows` on an unattended quit that skips it.
    quitGuard = QuitGuard(
      activeRuns: {
        screenshots.cancel()
        return await services.link.activeRunsForQuitGuard()
      },
      stopService: {
        await SupportDiagnostics.shared.stopForQuit()
        await computer.shutdown()
        control.stop()
        await services.stopForQuit()
      },
      hideWindows: {
        screenshots.cancel()
        for window in NSApp.windows { window.orderOut(nil) }
      })
    bridge.shell = self
    SupportDiagnostics.shared.onRecordingChanged = { [weak self] recording in
      let event = NativeEvent.diagnosticsRecording(.init(recording: recording))
      self?.panelHost.send(event, scope: .document)
      self?.settings.host?.send(event, scope: .document)
    }
    speech.onChange = { [weak self] speaking in
      self?.broadcast(.speechState(.init(speaking: speaking)))
    }
    updater.onChange = { [weak self] in
      guard let self else { return }
      panelHost.setState(.updateState(updater.state))
    }
    panel.onVisibilityChange = { [weak self, weak panelHost] visible in
      panelHost?.setState(.windowVisibility(.init(visible: visible)))
      // A command the page took to the panel ends its shortcut's press capsule.
      if visible { self?.commandProgress.panelShown() }
      if visible { self?.taskActivity.readShownConversation() }
      self?.notificationsPanelVisibility(visible)
    }
    panel.onGaveUpKey = { [weak self] in self?.passFocusOnFromPanel() }
    panelHost.setState(.accessibilityTrust(.init(trusted: trust.isTrusted)))
    trust.onChange = { [weak self] trusted in
      // Double-tap shortcuts arm or disarm with the trust before the pages learn it, so the
      // panel's next push reports them as they now are.
      self?.registrar?.reapply()
      self?.broadcast(.accessibilityTrust(.init(trusted: trusted)))
      self?.toolbar.update()
      // `computer.state` carries the PostEvent grant, which macOS never announces by itself.
      self?.broadcastComputerState()
    }
    panelHost.setState(.screenRecordingTrust(.init(trusted: screenRecording.isTrusted)))
    screenRecording.onChange = { [weak self] trusted in
      self?.broadcast(.screenRecordingTrust(.init(trusted: trusted)))
    }
    toolbar.onAsk = { [weak self] text in self?.summon(.ask, selectedText: text) }
    toolbar.onCommand = { [weak self] launch in self?.summon(.toolbarCommand(launch)) }
    toolbar.onPick = { [weak self] id, values in
      self?.panelHost.send(
        .commandOptionsPicked(.init(id: id, arguments: values)), scope: .document)
    }
    wireUserApps()
    wireMiniPanel()
  }

  /// Starts the service connection and the app-level surfaces, then loads the panel page,
  /// which pushes the shortcut set, `selectionWanted` and the language.
  public func start(revealPanel: Bool) {
    launchPresentation = LaunchPresentation(revealPanel: revealPanel)
    registrar = HotKeyRegistrar(
      canWatchKeyboard: { [trust] in trust.isTrusted },
      onPress: { [weak self] id in self?.shortcutHolds.pressed(id) },
      onRelease: { [weak self] id in self?.shortcutHolds.released(id) })
    statusItem = StatusItemController(
      toggle: { [weak self] in self?.summon(.toggle) },
      menu: { [weak self] in AppMenus.statusMenu(self?.menuActions ?? .inert) })
    control.onConnectionState = { [weak self] state in
      self?.refreshStatus()
      self?.computerConnectionChanged(state)
      if state == .disconnected { _ = try? self?.presentLaunch(.unavailable) }
      if state == .connected {
        self?.attachments.serviceDidConnect()
        self?.widgets.serviceDidConnect()
        self?.notifications?.pull()
      }
    }
    control.onStatus = { [weak self] _ in
      self?.refreshStatus()
      self?.taskActivity.refresh()
    }
    refreshStatus()
    services.start()
    startWidgets()
    startNotifications()
    startSystemActivity()
    control.start()
    // Before the stream's first connection opens, which says whether this shell is the host.
    startComputer()
    updater.start()
    miniPanel.start()
    trust.start()
    screenRecording.start()
    StaleGrantRecovery.start(
      defaults: defaults, accessibility: trust, screenRecording: screenRecording)
    presence.applyDockVisibility(windowOpen: keepsDockIcon)
    applyLanguage()
    NotificationCenter.default.addObserver(
      forName: ShellStrings.didChange, object: nil, queue: .main
    ) { [weak self] _ in MainActor.assumeIsolated { self?.applyLanguage() } }
    panelHost.setState(.windowVisibility(.init(visible: false)))
    panelHost.load()
  }

  // MARK: Summons

  /// Runs the summon flow of `SummonPolicy`: capture before the panel can take focus, or take
  /// `selectedText` as the selection when it is already known
  /// (``Summoner/summon(_:selectedText:)``).
  func summon(_ trigger: SummonTrigger, selectedText: String? = nil) {
    summoner.summon(trigger, selectedText: selectedText)
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
    presence.setShowInDock(show, windowOpen: keepsDockIcon)
  }

  /// The welcome guide and the settings window show the Dock icon while open, so the Dock and
  /// Command-Tab reach them whatever the preference.
  var keepsDockIcon: Bool { onboarding.host != nil || settings.isOpen }

  /// `openAtLogin` is null where it is unavailable (Debug builds); `widgetsAvailable` is false
  /// outside the folders macOS indexes for widgets (``WidgetPlacement``).
  func appState() -> AppStateResult {
    AppStateResult(
      pinned: isPinned, showInDock: presence.showInDock,
      openAtLogin: AppPresence.opensAtLogin, widgetsAvailable: widgets.isAvailable,
      panelPlacement: panelPlacementState())
  }

  /// A state event for every page, so a window opened later still learns the latest value.
  func broadcast(_ event: NativeEvent) {
    panelHost.setState(event)
    settings.host?.setState(event)
    onboarding.host?.setState(event)
  }
}
