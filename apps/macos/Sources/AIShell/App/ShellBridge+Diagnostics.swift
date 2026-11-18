import AICore
import Foundation

/// Exhaustive handler for all 6 `diagnostics.*` native bridge calls (`03` §3.2–§3.3).
///
/// Privacy & concurrency guarantees:
/// - Enforces the `<= 131_072` UTF-8 byte wire budget on `rendererBreadcrumbs`.
/// - Delegates preview, environment checks, and `.zip` creation to `nonisolated` `@concurrent`
///   engines (`ShellEnvironmentChecks`, `DiagnosticsExporter`) off `@MainActor`.
/// - Uses `SystemPanels.chooseEmergencyDiagnosticSaveURL` so a wedged `DeviceArbiter`
///   `.interactiveScreen` claim never deadlocks export, and returns ONLY `fileName` / `archiveBytes`
///   / `omittedFileCount` (NEVER exposing the user's chosen filesystem path to WebKit).
extension ShellBridge {
  static let maxBridgeBreadcrumbsUTF8Bytes = 131_072

  enum DiagnosticsCall {
    case shellReport(DiagnosticsShellReportParams)
    case liveProbeStart(DiagnosticsLiveProbeStartParams)
    case liveProbeStop(DiagnosticsLiveProbeStopParams)
    case previewBundle(DiagnosticsPreviewBundleParams)
    case exportBundle(DiagnosticsExportBundleParams)
    case restartService(DiagnosticsRestartServiceParams)
  }

  static func handleDiagnostics(
    _ call: DiagnosticsCall,
    from host: WebViewHost,
    shell: ShellController
  ) async throws(BridgeError) -> JSONValue {
    switch call {
    case .shellReport:
      let report = await shell.shellDiagnosticsReport()
      return try encode(report)

    case .liveProbeStart(let params):
      let started = shell.services.liveProbes.start(
        kind: params.kind, host: host, shell: shell)
      return try encode(started)

    case .liveProbeStop:
      shell.services.liveProbes.stop()
      return try encode(NativeEmpty())

    case .previewBundle(let params):
      try validateBreadcrumbsSize(params.rendererBreadcrumbs)
      let request = shell.makeDiagnosticsExportRequest(
        triggerSurface: .settings,
        includeCrashSummaries: params.includeCrashSummaries,
        rendererBreadcrumbs: params.rendererBreadcrumbs)
      do {
        let preview = try await DiagnosticsExporter.preview(request: request)
        return try encode(preview)
      } catch {
        throw BridgeError(message(error, "Could not assemble the diagnostic preview."))
      }

    case .exportBundle(let params):
      try validateBreadcrumbsSize(params.rendererBreadcrumbs)
      let now = Date()
      let suggestedName = DiagnosticsBundleBuilder.suggestedArchiveName(at: now)
      let chosenURL: URL?
      do {
        chosenURL = try await shell.systemPanels.chooseEmergencyDiagnosticSaveURL(
          suggestedName: suggestedName,
          ring: shell.services.decisionRings.captureArbiter)
      } catch {
        throw BridgeError(
          message(
            error, ShellStrings.shared.text(DiagnosticsStringKey.errorExportDiagnosticsMessage)))
      }
      guard let destinationURL = chosenURL else {
        return try encode(DiagnosticsExportBundleResult.cancelled(.init()))
      }

      let request = shell.makeDiagnosticsExportRequest(
        triggerSurface: .settings,
        includeCrashSummaries: params.includeCrashSummaries,
        rendererBreadcrumbs: params.rendererBreadcrumbs,
        generatedAt: now)
      do {
        let archive = try await DiagnosticsExporter.exportZip(
          request: request, destinationZipURL: destinationURL)
        shell.services.shellLog.enqueue(
          level: .info,
          category: "diagnostics",
          message: "bundle_exported:settings bytes=\(archive.archiveBytes)")
        return try encode(
          DiagnosticsExportBundleResult.saved(
            .init(
              fileName: archive.fileName,
              archiveBytes: max(1, archive.archiveBytes),
              omittedFileCount: max(0, archive.omittedFileCount))))
      } catch {
        try? FileManager.default.removeItem(at: destinationURL)
        throw BridgeError(
          message(
            error, ShellStrings.shared.text(DiagnosticsStringKey.errorExportDiagnosticsMessage)))
      }

    case .restartService:
      let result = await shell.restartServiceForDiagnostics()
      return try encode(result)
    }
  }

  private static func validateBreadcrumbsSize(
    _ payload: RendererBreadcrumbsPayload
  ) throws(BridgeError) {
    guard let encoded = try? JSONEncoder().encode(payload),
      encoded.count <= maxBridgeBreadcrumbsUTF8Bytes
    else {
      throw BridgeError("Renderer breadcrumbs exceeded the 128 KiB limit.")
    }
  }
}
