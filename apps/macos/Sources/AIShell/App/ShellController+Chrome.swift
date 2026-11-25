import AIChromeChannelKit
import AICore
import AIRelay
import AppKit

/// Atd for Chrome's place in the shell (D3, D4, D10, D12): the channel starts with computer use,
/// runs its requests through the shell's own service client, shows the panel or Settings for the
/// extension, and stops runs the way the task activity card does. Its connected profiles are the
/// chrome engine's links; its state is part of `computer.state`.
extension ShellController {
  func makeChromeChannel() -> ChromeChannel {
    let identity = ChromeChannelIdentity(info: Bundle.main.infoDictionary) ?? .configured
    let environment = ChromeChannelEnvironment(
      client: { [services] in try await services.client() },
      hostState: { [weak self] in self?.chromeHostState() ?? .serviceUnavailable },
      prefs: {
        ChromePrefs(
          language: ShellStrings.shared.language == .simplifiedChinese
            ? .simplifiedChinese : .english,
          glowEffects: GlowEffects.shared.enabled)
      },
      appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        ?? "0",
      openTask: { [weak self] taskId in
        guard let self else { return }
        guard let taskId else { return showPanel() }
        openNotifiedTask(taskId)
      },
      openComputerSettings: { [weak self] in
        self?.openSettings(commandId: nil, section: "computer")
      },
      stopRun: { [weak self] taskId, runId in self?.stopChromeRun(taskId: taskId, runId: runId) },
      onStateChange: { [weak self] in self?.broadcastComputerState() },
      chromeBinding: { [weak self] in self?.chromeBinding($0) })
    return ChromeChannel(
      identity: identity, environment: environment,
      pairing: ChromePairingPrompt(
        confirmations: confirmations,
        screenBusy: { [weak self] in self?.chromePromptBlocked ?? true }
      ))
  }

  /// Registers the chrome engine on the channel's links and starts the channel; part of
  /// ``startComputer()``.
  func startChrome() {
    computer.engines.register(makeChromeComputer(links: chrome.links))
    computer.chromeState = { [weak self] in
      self?.chrome.stateEvent ?? ChromeChannelState.unavailable
    }
    computer.progress.observe = { [weak self] frame, ref in
      self?.chrome.projection.progress(frame, ref: ref)
    }
    // D12: a selection on a page the connected extension serves (its `focus.state` says so)
    // gets the extension's toolbar; everywhere else in Chrome the native one stays.
    toolbar.probeRunner.yieldsToExtension = { [weak self] pid in
      self?.chrome.links.links.values.contains {
        $0.browserPid == pid && $0.focus?.eligible == true
      }
        == true
    }
    chrome.start()
  }

  /// The binding `bindingId` as a site of the person's own Chrome: one a run resolved, or one
  /// the person allowed from the extension.
  func chromeBinding(_ bindingId: String) -> TargetBindingWire.Browser? {
    computer.targets.chromeBinding(bindingId)
      ?? chrome.siteBindings.first { $0.bindingId == bindingId }
  }

  /// Settings › Computer use › Atd for Chrome › Disconnect (`computer.chrome.disconnect`).
  func disconnectChrome(installationId: String) async {
    await chrome.disconnect(installationId: installationId)
  }

  /// Settings › Computer use › Atd for Chrome › Refresh (`computer.chrome.refresh`).
  func refreshChrome() async {
    await chrome.refreshHostManifests(force: true)
  }

  /// The control stream connected or went away: the extension's runs follow, and on a connection
  /// the site bindings are listed again (the reconciliation with the pairings).
  func chromeConnectionChanged(_ state: ControlStreamClient.ConnectionState) {
    chrome.projection.connectionChanged()
    chrome.refreshWelcomes()
    guard state == .connected else { return }
    Task { [weak self] in await self?.chrome.refreshSites() }
  }

  private func chromeHostState() -> ChromeHostState {
    guard computerHost.lock.isHeld else { return .otherHost }
    return control.state == .connected ? .ready : .serviceUnavailable
  }

  /// No pairing alert over a capture, or while a system open or save panel is up.
  private var chromePromptBlocked: Bool {
    screenshots.isCapturing || systemPanels.isOpen
  }

  /// `run.stop` and the infobar's Cancel: cancels the run as the task activity card's Stop does,
  /// and gives the panel back the queued messages the run did not send.
  private func stopChromeRun(taskId: String, runId: String) {
    Task { [weak self] in
      do {
        guard let client = try await self?.services.client() else { return }
        let unsent = try await client.cancelRun(taskId: taskId, runId: runId)
        guard let self, !unsent.steering.isEmpty || !unsent.followUp.isEmpty else { return }
        panelHost.send(
          .taskQueueWithdrawn(
            .init(
              taskId: taskId, runId: runId,
              unsent: .init(steering: unsent.steering, followUp: unsent.followUp))))
      } catch {
        ChromeChannel.log.error(
          "A run from Chrome could not be stopped: \(String(describing: error), privacy: .public)")
      }
    }
  }
}
