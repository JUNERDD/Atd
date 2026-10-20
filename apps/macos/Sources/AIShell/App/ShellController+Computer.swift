import AICore
import AIRelay
import AppKit

/// The computer host's place in the shell: the coordinator joins the control stream, its state
/// reaches every page as `computer.state`, and the renderer's `computer.*` calls land here.
extension ShellController {
  static func makeComputer(
    host: ComputerHostSession, arbiter: DeviceArbiter, defaults: UserDefaults
  )
    -> ComputerCoordinator
  {
    ComputerCoordinator(
      host: host, arbiter: arbiter, pointer: ActivityPointerController(), defaults: defaults)
  }

  /// Registers the engines and the preparer, joins the coordinator to the control stream and
  /// takes the host lock. Runs in the same main-actor turn as `control.start()`, so before the
  /// stream's first connection opens and says whether this shell is the host. The engines are
  /// `notInstalled` until the add-ons are read (``startAddons()``); an installed one starts on
  /// the first request that needs it; quitting stops both (`ComputerCoordinator.shutdown`).
  func startComputer() {
    let browser = makeBrowserComputer()
    let native = makeNativeComputer()
    computer.engines.register(browser.engine)
    computer.engines.register(native.engine)
    computer.preparer = CompositeTargetPreparer(
      browser: browser.preparer, application: native.application)
    computer.accessPreparer = browser.access
    control.computer = computer
    computer.announce = { [weak control] in control?.announceComputerHost() }
    computer.progress.send = { [weak control] in control?.sendComputerProgress($0) }
    computer.onStateChange = { [weak self] in self?.broadcastComputerState() }
    panelHost.onDocumentUnload = { [weak self] in self?.shownComputerTaskId = nil }
    computer.start()
    startAddons()
  }

  func broadcastComputerState() {
    broadcast(.computerState(computer.stateEvent()))
  }

  /// A page opened later learns the state too.
  func replayComputer(to host: WebViewHost) {
    host.setState(.computerState(computer.stateEvent()))
  }

  // MARK: Bridge calls

  func prepareComputerBrowser(_ params: ComputerPrepareBrowserParams) async
    -> ComputerPrepareBrowserResult
  {
    guard let preparer = computer.preparer else { return .notOk(.init(reason: .unavailable)) }
    return await preparer.prepareBrowser(params)
  }

  func prepareComputerApplication(_ params: ComputerPrepareApplicationParams) async
    -> ComputerPrepareApplicationResult
  {
    guard let preparer = computer.preparer else { return .notOk(.init(reason: .unavailable)) }
    return await preparer.prepareApplication(params)
  }

  func openComputerProfile(bindingId: String) async throws(BridgeError) {
    guard let preparer = computer.preparer else {
      throw BridgeError("Browser profiles are unavailable in this build.")
    }
    try await preparer.openProfile(bindingId: bindingId)
  }

  /// `computer.primeCaptureConsent`: the person prepares screen-capture consent from Settings.
  func primeComputerCaptureConsent() async -> ComputerPrimeCaptureConsentResult {
    await computer.primeCaptureConsent()
  }

  /// `computer.acknowledgeUnsettled`: the person checked what the listed actions may have
  /// changed.
  func acknowledgeComputerUnsettled(_ params: ComputerAcknowledgeUnsettledParams) {
    computer.acknowledgeUnsettled(params.actionIds)
  }

  func authorizeComputerAutomation(_ params: ComputerAuthorizeAutomationParams)
    async throws(BridgeError) -> ComputerAuthorizeAutomationResult
  {
    try await AutomationComputerApprovals.request(
      params, services: services, confirmations: confirmations, systemPanels: systemPanels)
  }
}
