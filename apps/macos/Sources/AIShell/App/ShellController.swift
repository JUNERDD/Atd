import AICore
import AppKit

/// Wires the shell together: the panel and settings windows, the summon flow, global hot keys,
/// the selection stash, the status item, menus and the quit guard. Its methods are the entry
/// points ``ShellBridge`` exposes to the pages.
@MainActor
public final class ShellController: ShellEventSending {
  private let services: ShellServices
  private let defaults: UserDefaults
  private let bridge: ShellBridge
  let panelHost: WebViewHost
  let panel: PanelWindowController
  private let settings: SettingsWindowController
  private let systemPanels: SystemPanels
  private var statusItem: StatusItemController?
  private var registrar: HotKeyRegistrar?
  private(set) var quitGuard: QuitGuard
  let capabilities: ShellCapabilities
  let artifacts: ArtifactActions
  private(set) lazy var attachments = AttachmentImporter(
    resources: services.resources, sink: eventSink, systemPanels: systemPanels)
  /// Where command shortcuts and attachment results go; the controller's own hosts unless
  /// integration injects another sink.
  private let injectedSink: (any ShellEventSending)?
  private var eventSink: any ShellEventSending { injectedSink ?? self }

  private(set) var selectionWanted = false
  private var stash: CapturedText?
  private var summoning = false
  private var trustRequested = false

  private static let pinnedKey = "panel.pinned"
  private static let showInDockKey = "app.showInDock"

  public init(
    services: ShellServices, eventSink: (any ShellEventSending)? = nil,
    defaults: UserDefaults = .standard
  ) {
    self.services = services
    self.injectedSink = eventSink
    self.defaults = defaults
    let bridge = ShellBridge(fallback: services.router)
    self.bridge = bridge
    panelHost = WebViewHost(
      role: .panel, fragment: nil, webContent: services.webContent, router: bridge)
    let panel = PanelWindowController(
      host: panelHost, pinned: defaults.bool(forKey: Self.pinnedKey))
    self.panel = panel
    settings = SettingsWindowController { fragment in
      WebViewHost(
        role: .settings, fragment: fragment, webContent: services.webContent, router: bridge)
    }
    let systemPanels = SystemPanels(
      lowerPanel: { panel.lowerForSystemPanel() }, restorePanel: { panel.restoreLevel($0) })
    self.systemPanels = systemPanels
    capabilities = ShellCapabilities(
      resources: services.resources, panelVisible: { panel.isVisible }, systemPanels: systemPanels)
    artifacts = ArtifactActions(artifacts: services.artifacts, downloads: Self.downloadsFolder())
    quitGuard = QuitGuard(
      activeRuns: services.activeRuns, control: services.control,
      hideWindows: {
        for window in NSApp.windows { window.orderOut(nil) }
      })
    bridge.shell = self
    panelHost.onFiles = { [weak self] urls, source in
      guard let self else { return }
      Task { await self.attachments.importFiles(urls, source: source) }
    }
    panel.onVisibilityChange = { [weak panelHost] visible in
      panelHost?.setState(ShellEventName.windowVisibility, .bool(visible))
    }
    panel.onGaveUpKey = { [weak self] in self?.passFocusOnFromPanel() }
  }

  /// Starts the app-level surfaces and loads the panel page, which then pushes the hot key
  /// set, `selectionWanted` and the language.
  public func start(revealPanel: Bool) {
    registrar = HotKeyRegistrar { [weak self] id in self?.summon(SummonTrigger(hotKeyID: id)) }
    statusItem = StatusItemController(
      toggle: { [weak self] in self?.summon(.toggle) },
      menu: { [weak self] in AppMenus.statusMenu(self?.menuActions ?? .inert) })
    services.status.observeSnapshot { [weak self] snapshot in self?.statusChanged(snapshot) }
    statusChanged(services.status.snapshot)
    AppPresence.setShowInDock(defaults.bool(forKey: Self.showInDockKey))
    applyLanguage()
    NotificationCenter.default.addObserver(
      forName: ShellStrings.didChange, object: nil, queue: .main
    ) { [weak self] _ in MainActor.assumeIsolated { self?.applyLanguage() } }
    panelHost.setState(ShellEventName.windowVisibility, .bool(false))
    panelHost.load()
    if revealPanel { summon(.toggle) }
  }

  // MARK: Summons

  /// Runs the summon flow of `SummonPolicy`: capture before the panel can take focus.
  func summon(_ trigger: SummonTrigger) {
    guard !summoning else { return }
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
        case .deliverCommand(let id):
          eventSink.send(
            ShellEvent(name: ShellEventName.commandShortcut, payload: .object(["id": .string(id)])),
            to: .panel)
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

  /// Shows the panel where it is, as Show task panel and the page's `show` do.
  func showPanel() {
    guard !systemPanels.isOpen else { return }
    panel.show()
  }

  func hidePanel() {
    guard !systemPanels.isOpen else { return }
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

  func openSettings(fragment: String?) {
    settings.open(
      fragment: fragment ?? "settings", title: ShellStrings.shared.text(.windowSettingsTitle))
  }

  func applyHotKeys(_ requests: [HotKeyRequest]) -> [HotKeyReport] {
    registrar?.apply(requests) ?? []
  }

  func setSelectionWanted(_ wanted: Bool) {
    selectionWanted = wanted
    if !wanted { stash = nil }
  }

  /// `capture('selection')` returns the summon stash; `capture('clipboard')` reads now.
  func capture(_ source: String) throws(BridgeError) -> CapturedText {
    let result: Result<CapturedText, CaptureFailure>
    switch source {
    case "selection":
      result = TextCapture.selection(stash: stash, trusted: SelectionReader.isTrusted)
    case "clipboard":
      result = TextCapture.clipboard(NSPasteboard.general.string(forType: .string), at: .now)
    default: throw BridgeError("Unknown capture source.")
    }
    switch result {
    case .success(let captured): return captured
    case .failure(let failure): throw BridgeError(failure.message)
    }
  }

  func setPinned(_ pinned: Bool) {
    defaults.set(pinned, forKey: Self.pinnedKey)
    panel.setPinned(pinned)
  }

  func setShowInDock(_ show: Bool) {
    defaults.set(show, forKey: Self.showInDockKey)
    AppPresence.setShowInDock(show)
  }

  /// `{ pinned, showInDock, openAtLogin }`; `openAtLogin` is null where it is unavailable.
  func windowPreferences() -> JSONValue {
    .object([
      "pinned": .bool(defaults.bool(forKey: Self.pinnedKey)),
      "showInDock": .bool(defaults.bool(forKey: Self.showInDockKey)),
      "openAtLogin": AppPresence.opensAtLogin.map(JSONValue.bool) ?? .null,
    ])
  }

  func setLanguage(_ language: String) -> Bool {
    ShellStrings.shared.apply(appLanguage: language)
  }

  func openLink(_ value: String) throws(BridgeError) {
    guard let url = ExternalLink.openable(value) else {
      throw BridgeError("Only web links can be opened.")
    }
    NSWorkspace.shared.open(url)
  }

  func copy(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
  }

  // MARK: ShellEventSending

  public func send(_ event: ShellEvent, to role: WebViewRole) {
    host(for: role)?.send(event)
  }

  public func setState(_ name: String, _ payload: JSONValue, for role: WebViewRole) {
    host(for: role)?.setState(name, payload)
  }

  private func host(for role: WebViewRole) -> WebViewHost? {
    role == .panel ? panelHost : settings.host
  }

  // MARK: App surfaces

  private func statusChanged(_ snapshot: ServiceSnapshot) {
    statusItem?.update(
      MenuBarStatus(
        availability: snapshot.availability, running: snapshot.running,
        attention: snapshot.attention))
  }

  private func applyLanguage() {
    NSApp.mainMenu = AppMenus.mainMenu(menuActions)
    panel.setTitle(ShellStrings.shared.text(.windowPanelTitle))
    settings.setTitle(ShellStrings.shared.text(.windowSettingsTitle))
  }

  var menuActions: AppMenuActions {
    let control = services.control
    let status = services.status
    return AppMenuActions(
      showPanel: { [weak self] in self?.showPanel() },
      hidePanel: { [weak self] in self?.hidePanel() },
      openSettings: { [weak self] in self?.openSettings(fragment: nil) },
      restartService: { try await control.restartService() },
      showServiceLogs: { try await control.revealServiceLogs() },
      editCommand: { [weak self] command in self?.sendEditCommand(command) },
      developmentHint: {
        MenuBarStatus(availability: status.snapshot.availability, running: 0, attention: 0)
          .developmentHint
      })
  }

  /// Undo and Redo go to the page of the key window.
  private func sendEditCommand(_ command: String) {
    let event = ShellEvent(
      name: ShellEventName.editCommand, payload: .object(["command": .string(command)]))
    if panel.isKey { panelHost.send(event) } else if settings.isKey { settings.host?.send(event) }
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
