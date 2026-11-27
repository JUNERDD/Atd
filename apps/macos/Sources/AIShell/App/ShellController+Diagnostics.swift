import AICore
import AIRelay
import AppKit
import CoreGraphics

/// Native diagnostics snapshot assembly, menu / recovery-card confirmation dialog, and supervised
/// restart bridge support (`03` §3.2, §4.2–§4.3).
///
/// Keeps ``ShellController`` (`<= 349` lines) free of diagnostic modal UI and snapshot plumbing.
extension ShellController {
  /// Evaluates the Swift Shell Doctor plane off `@MainActor` (`<= 1,500 ms` total wall budget).
  func shellDiagnosticsReport() async -> DiagnosticsShellReportResult {
    let snap = captureDiagnosticsMainActorSnapshot()
    let eval = await ShellEnvironmentChecks.evaluate(
      snapshot: snap, decisionRings: services.decisionRings)
    return DiagnosticsShellReportResult(
      capturedAt: eval.capturedAt,
      appVersion: snap.appVersion,
      buildNumber: snap.buildNumber,
      isDevelopment: snap.isDevelopment,
      serviceState: snap.serviceState,
      serviceFailureCode: snap.serviceFailureCode,
      serviceFailureSummary: snap.serviceFailureSummary,
      checks: eval.checks,
      rings: eval.rings)
  }

  func makeDiagnosticsExportRequest(
    triggerSurface: DiagnosticsTriggerSurface,
    includeCrashSummaries: Bool,
    rendererBreadcrumbs: RendererBreadcrumbsPayload,
    generatedAt: Date = Date()
  ) -> DiagnosticsExporter.ExportRequest {
    let snap = captureDiagnosticsMainActorSnapshot()
    let recoveryCtx = services.recoveryServiceContext()
    return DiagnosticsExporter.ExportRequest(
      triggerSurface: triggerSurface,
      includeCrashSummaries: includeCrashSummaries,
      rendererBreadcrumbs: rendererBreadcrumbs,
      mainActorSnapshot: snap,
      decisionRings: services.decisionRings,
      shellLog: services.shellLog,
      serviceLogDirectoryURL: services.logDirectory,
      dataDirectoryURL: services.dataDirectory,
      crashReportsDirectoryURL: nil,
      recentServiceExits: services.supervisor?.recentExits ?? [],
      serviceEndpoint: snap.runningServiceEndpoint,
      serviceUnavailable: recoveryCtx.unavailable,
      lastFailureSummary: recoveryCtx.lastFailureSummary,
      temporaryDirectoryURL: services.diagnosticsTemporaryDirectoryURL,
      generatedAt: generatedAt,
      chromeExtensionLog: services.chromeExtensionLog)
  }

  /// Menu-bar, app-menu, and ``WindowRecoveryView`` export flow:
  /// 1. Shows a compact native confirmation alert via ``NestedRunLoop/runModal(_:)`` explaining
  ///    automatic redaction and offering an **unchecked-by-default** crash summary opt-in checkbox.
  /// 2. Presents ``SystemPanels/chooseEmergencyDiagnosticSaveURL(suggestedName:ring:)`` (bypassing
  ///    any wedged `.interactiveScreen` claim).
  /// 3. Samples live renderer breadcrumbs with a hard `1s` `ContinuousClock` timeout, stamps
  ///    `generatedAt` at export start, and runs ``DiagnosticsExporter`` off `@MainActor`.
  func exportDiagnosticsFromNativeUI(
    triggerSurface: DiagnosticsTriggerSurface
  ) async throws -> Bool {
    guard !isCapturingScreenshot else {
      throw ShellServiceError("Finish the screenshot first.")
    }
    guard let includeCrashSummaries = await promptNativeDiagnosticsConfirmation() else {
      return false
    }

    let suggestedName = DiagnosticsBundleBuilder.suggestedArchiveName(at: Date())

    guard
      let destinationURL = try await systemPanels.chooseEmergencyDiagnosticSaveURL(
        suggestedName: suggestedName,
        ring: services.decisionRings.captureArbiter)
    else {
      return false
    }

    let breadcrumbs = await collectDiagnosticsBreadcrumbs()
    let request = makeDiagnosticsExportRequest(
      triggerSurface: triggerSurface,
      includeCrashSummaries: includeCrashSummaries,
      rendererBreadcrumbs: breadcrumbs,
      generatedAt: Date())

    let archive = try await DiagnosticsExporter.exportZip(
      request: request, destinationZipURL: destinationURL)
    services.shellLog.enqueue(
      level: .info,
      category: "diagnostics",
      message: "bundle_exported:\(triggerSurface.rawValue) bytes=\(archive.archiveBytes)")
    return true
  }

  /// Reads and chronologically merges renderer breadcrumbs across `panelHost` and `settings.host`
  /// when distinct, enforcing `<= 128` entries and `<= 128 KiB` UTF-8 JSON.
  func collectDiagnosticsBreadcrumbs(
    callerHost: WebViewHost? = nil,
    callerPayload: RendererBreadcrumbsPayload? = nil
  ) async -> RendererBreadcrumbsPayload {
    if let callerHost, let callerPayload {
      if callerHost !== panelHost {
        let panelCrumbs = await panelHost.readDiagnosticsBreadcrumbs(timeout: .seconds(1))
        if let settingsHost = settings.host, settingsHost !== callerHost, settingsHost !== panelHost
        {
          let settingsCrumbs = await settingsHost.readDiagnosticsBreadcrumbs(timeout: .seconds(1))
          return WebViewHost.mergeBreadcrumbs([panelCrumbs, settingsCrumbs, callerPayload])
        }
        return WebViewHost.mergeBreadcrumbs([panelCrumbs, callerPayload])
      }
      if let settingsHost = settings.host, settingsHost !== panelHost {
        let settingsCrumbs = await settingsHost.readDiagnosticsBreadcrumbs(timeout: .seconds(1))
        return WebViewHost.mergeBreadcrumbs([callerPayload, settingsCrumbs])
      }
      return WebViewHost.mergeBreadcrumbs([callerPayload])
    }

    if let settingsHost = settings.host, settingsHost !== panelHost {
      async let panelCrumbs = panelHost.readDiagnosticsBreadcrumbs(timeout: .seconds(1))
      async let settingsCrumbs = settingsHost.readDiagnosticsBreadcrumbs(timeout: .seconds(1))
      return await WebViewHost.mergeBreadcrumbs([panelCrumbs, settingsCrumbs])
    }
    let panelCrumbs = await panelHost.readDiagnosticsBreadcrumbs(timeout: .seconds(1))
    return WebViewHost.mergeBreadcrumbs([panelCrumbs])
  }

  /// `diagnostics.restartService`: restarts the supervised service in Release builds and returns a
  /// structured `DiagnosticsRestartServiceResult` with pre-scrubbed failure summary on error.
  func restartServiceForDiagnostics() async -> DiagnosticsRestartServiceResult {
    guard let supervisor = services.supervisor else {
      let msg = DiagnosticsScrubber.scrubInlineSummary(
        ShellStrings.shared.text(.errorDevelopmentRestart), maxUTF8Bytes: 200)
      return .notOk(
        .init(
          reasonCode: "development_unmanaged",
          summary: msg.isEmpty ? "Development service is managed by pnpm dev." : msg))
    }
    await supervisor.restart()
    switch supervisor.state {
    case .running:
      return .ok(.init())
    case .unavailable(let reason):
      let desc = ServiceUnavailableDescriptor.describe(
        reason, lastFailure: supervisor.lastFailureSummary)
      return .notOk(.init(reasonCode: desc.errorCode, summary: desc.summary))
    case .idle, .starting, .restarting:
      return .notOk(
        .init(reasonCode: "service_starting", summary: "The agent service is starting."))
    }
  }

  private func promptNativeDiagnosticsConfirmation() async -> Bool? {
    if let override = services.nativeDiagnosticsConsentOverrideForTesting {
      return await override()
    }
    let strings = ShellStrings.shared
    let alert = NSAlert()
    alert.alertStyle = .informational
    alert.messageText = strings.text(DiagnosticsStringKey.exportConfirmTitle)
    alert.informativeText = strings.text(DiagnosticsStringKey.exportConfirmMessage)
    alert.addButton(withTitle: strings.text(DiagnosticsStringKey.exportSaveButton))
    alert.addButton(withTitle: strings.text(DiagnosticsStringKey.exportCancelButton))

    let checkbox = DiagnosticsConsentCheckbox(
      title: strings.text(DiagnosticsStringKey.exportIncludeCrashes))
    checkbox.state = .off  // Strictly unchecked by default (opt-in crash summaries).
    checkbox.sizeToFit()
    alert.accessoryView = checkbox

    NSApp.activate()
    let response = await NestedRunLoop.runModal(alert)
    guard response == .alertFirstButtonReturn else { return nil }
    return checkbox.state == .on
  }

  func captureDiagnosticsMainActorSnapshot() -> ShellEnvironmentChecks.MainActorSnapshot {
    let info = Bundle.main.infoDictionary ?? [:]
    let shortVer = (info["CFBundleShortVersionString"] as? String) ?? "0.0.0"
    let buildVer = (info["CFBundleVersion"] as? String) ?? "0"
    let bundleId =
      Bundle.main.bundleIdentifier
      ?? (services.isDevelopment ? "com.junerdd.ai.dev" : "com.junerdd.ai")

    let grantHistory = StaleGrantRecovery.diagnosticsHistory(
      defaults: defaults,
      accessibilityTrusted: trust.isTrusted,
      screenRecordingTrusted: screenRecording.isTrusted)

    let uuremoteRunning = !NSRunningApplication.runningApplications(
      withBundleIdentifier: "com.netease.uuremote"
    ).isEmpty

    let displays: [DiagnosticsEnvironmentRecord.DisplayGeometryRecord] =
      NSScreen.screens.enumerated().map { index, screen in
        let builtin = screen.displayID.map { CGDisplayIsBuiltin($0) != 0 } ?? false
        return .init(
          index: index,
          widthPoints: Int(screen.frame.width.rounded()),
          heightPoints: Int(screen.frame.height.rounded()),
          backingScaleFactor: Double(screen.backingScaleFactor),
          isBuiltin: builtin,
          sdrSnapshotSupported: true)
      }

    let svcTuple = resolveServiceStateSnapshot()
    let hostBusy: Bool =
      if case .busy = computerHost.lock.state { true } else { false }
    let unsettled =
      (try? computerHost.lock.readUnsettled()) != nil
      || FileManager.default.fileExists(
        atPath: computerHost.lock.unsettledURL.path(percentEncoded: false))

    return ShellEnvironmentChecks.MainActorSnapshot(
      bundleIdentifier: bundleId,
      bundleURL: Bundle.main.bundleURL,
      builtInPlugInsURL: Bundle.main.builtInPlugInsURL,
      homePath: FileManager.default.homeDirectoryForCurrentUser.path(percentEncoded: false),
      dataDirectory: services.dataDirectory,
      appVersion: shortVer,
      buildNumber: buildVer,
      isDevelopment: services.isDevelopment,
      updaterConfigured: updater.isAvailable,
      customFeedOverrideSet: defaults.string(forKey: "SUFeedURL") != nil,
      widgetsAvailable: widgets.isAvailable,
      accessibilityTrusted: trust.isTrusted,
      accessibilityPreviouslyHeld: grantHistory.previouslyHeld.contains(.accessibility),
      screenRecordingTrusted: screenRecording.isTrusted,
      screenRecordingPreviouslyHeld: grantHistory.previouslyHeld.contains(.screenRecording),
      storedRequirement: grantHistory.storedRequirement,
      uuremoteRunning: uuremoteRunning,
      uuremoteTapFailed: registrar?.uuremoteTapInstallFailed == true,
      selectionToolbar: toolbar.diagnosticsSnapshot,
      displays: displays,
      serviceState: svcTuple.state,
      serviceFailureCode: svcTuple.failureCode,
      serviceFailureSummary: svcTuple.failureSummary,
      runningServiceEndpoint: svcTuple.endpoint,
      allowedExecutableRoot: services.supervisor?.allowedExecutableRoot,
      controlReconnecting: control.state == .reconnecting,
      hostLockHeldByOther: hostBusy,
      unsettledSessionPending: unsettled,
      heldArbiterClaims: deviceArbiter.heldResourceSummaries(),
      devServerOrigin: services.devServerOrigin,
      chromeHostManifest: chrome.hostManifest,
      chromeListenerActive: chrome.isListenerActive,
      chromePairedCount: chrome.store?.pairings.count ?? 0,
      chromeConnectedCount: chrome.links.links.count,
      chromeInstalledBrowserCount: chrome.installedBrowsers.count)
  }

  private func resolveServiceStateSnapshot() -> (
    state: DiagnosticsShellReportResult.ServiceState,
    failureCode: DiagnosticsShellReportResult.ServiceFailureCode?,
    failureSummary: String?,
    endpoint: ServiceEndpoint?
  ) {
    if let supervisor = services.supervisor {
      switch supervisor.state {
      case .idle:
        return (.idle, nil, nil, nil)
      case .starting:
        return (.starting, .serviceStarting, nil, nil)
      case .restarting:
        return (.restarting, .serviceStarting, supervisor.lastFailureSummary, nil)
      case .running(let ep):
        return (.running, nil, nil, ep)
      case .unavailable(let reason):
        let desc = ServiceUnavailableDescriptor.describe(
          reason, lastFailure: supervisor.lastFailureSummary)
        return (.unavailable, Self.mapFailureCode(desc.errorCode), desc.summary, nil)
      }
    }

    switch ServiceDiscovery.read(dataDirectory: services.dataDirectory) {
    case .success(let ep):
      return (.running, nil, nil, ep)
    case .failure(let err):
      let unavail: ServiceUnavailable =
        (err == .notRunning || err == .stale)
        ? .developmentServiceNotRunning : .invalidEndpoint(err)
      let desc = ServiceUnavailableDescriptor.describe(
        unavail, lastFailure: services.link.lastFailureSummary)
      return (.unavailable, Self.mapFailureCode(desc.errorCode), desc.summary, nil)
    }
  }

  private static func mapFailureCode(
    _ code: String
  ) -> DiagnosticsShellReportResult.ServiceFailureCode? {
    DiagnosticsShellReportResult.ServiceFailureCode(rawValue: code)
  }
}

/// Native checkbox control using ``PointerRole`` cursor mapping (`AGENTS.md:125`).
final class DiagnosticsConsentCheckbox: NSButton {
  init(title: String) {
    super.init(frame: .zero)
    setButtonType(.switch)
    self.title = title
    setAccessibilityLabel(title)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func resetCursorRects() {
    super.resetCursorRects()
    addCursorRect(bounds, cursor: PointerRole(button: self).cursor)
  }
}
