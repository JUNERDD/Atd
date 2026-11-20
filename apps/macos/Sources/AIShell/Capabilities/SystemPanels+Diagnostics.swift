import AICore
import AppKit
import UniformTypeIdentifiers

/// Localized reentrancy failure thrown when another modal file dialog is already open.
struct EmergencySavePanelBusyError: LocalizedError, Equatable, Sendable {
  let message: String

  nonisolated init(message: String) {
    self.message = message
  }

  nonisolated var errorDescription: String? { message }
}

/// Emergency diagnostics archive save-panel flow (`03-contracts-routes-and-ui.md` §4.2).
///
/// Ordinary `SystemPanels.chooseSaveFile` calls `arbiter.tryClaim([.interactiveScreen])` and
/// silently returns `nil` when a wedged capture or foreground computer step holds
/// `.interactiveScreen`. Diagnostic bundle export must remain reachable under that exact failure:
/// 1. If another file dialog is genuinely open (`isOpen == true`), activates `NSApp` and throws
///    localized `DiagnosticsStringKey.exportPanelAlreadyOpen` so the caller surfaces a clear alert.
/// 2. Attempts `arbiter.tryClaim([.interactiveScreen], owner: .user(.systemPanel))`; when refused,
///    records `arbiter.heldClaims` (`"emergency_save_panel_bypassed_arbiter"`) into the
///    `capture_arbiter` ring, lowers the resident task panel, presents an independent `.zip`
///    `NSSavePanel` at `.statusBar + 3` above overlays and the Dynamic Island, and restores state
///    unconditionally in `defer`.
/// 3. Callers write the archive locally and never return the chosen filesystem path to WebKit.
extension SystemPanels {
  /// Level above `IslandWindow` (`statusBar + 0`), `IslandLightboxWindow` (`statusBar + 1`), and
  /// normal above-island save panels (`statusBar + 2`).
  static var emergencyDiagnosticPanelLevel: NSWindow.Level {
    NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 3)
  }

  /// Evaluates reentrancy and `DeviceArbiter` `.interactiveScreen` admission without opening UI
  /// (exposed separately so unit tests verify deadlock-bypass telemetry deterministically).
  func prepareEmergencySaveAdmission(ring: CaptureAndArbiterRing?) throws -> ResourceClaim? {
    if isOpen {
      NSApp?.activate()
      throw EmergencySavePanelBusyError(
        message: ShellStrings.shared.text(DiagnosticsStringKey.exportPanelAlreadyOpen))
    }
    do {
      return try arbiter.tryClaim([.interactiveScreen], owner: .user(.systemPanel))
    } catch {
      recordArbiterBypass(ring: ring, refusal: error)
      return nil
    }
  }

  func chooseEmergencyDiagnosticSaveURL(
    suggestedName: String,
    ring: CaptureAndArbiterRing?
  ) async throws -> URL? {
    if let override = emergencySaveURLOverrideForTesting {
      return try await override(suggestedName)
    }
    let claim = try prepareEmergencySaveAdmission(ring: ring)
    isOpen = true
    lowerPanel()

    let panel = NSSavePanel()
    panel.title = ShellStrings.shared.text(.fileSaveTitle)
    panel.allowedContentTypes = [.zip]
    panel.canCreateDirectories = true
    panel.isExtensionHidden = false
    panel.nameFieldStringValue = suggestedName
    let level = Self.emergencyDiagnosticPanelLevel
    panel.level = level

    let levelObserver = NotificationCenter.default.addObserver(
      forName: NSWindow.didBecomeKeyNotification,
      object: panel,
      queue: .main
    ) { [weak panel] _ in
      MainActor.assumeIsolated { panel?.level = level }
    }

    defer {
      NotificationCenter.default.removeObserver(levelObserver)
      isOpen = false
      restorePanel()
      claim?.release()
    }

    NSApp?.activate()
    return await panel.begin() == .OK ? panel.url : nil
  }

  private func recordArbiterBypass(ring: CaptureAndArbiterRing?, refusal: ClaimRefusal) {
    guard let ring else { return }
    var entry = CaptureAndArbiterEntry()
    entry.uptimeNs = MonotonicTimestampAnchor.nowUptimeNs()
    entry.eventKind = 9
    entry.outcome = 2
    entry.resourceMask = 1
    entry.flags = 1
    let holders = arbiter.heldClaims.map { String(describing: $0.owner) }.joined(separator: ",")
    let summary =
      holders.isEmpty
      ? "emergency_save_panel_bypassed_arbiter:\(refusal)"
      : "emergency_save_panel_bypassed_arbiter:\(holders)"
    entry.ownerSummary = InlineText64(truncatingUTF8: summary)
    ring.append(entry)
  }
}
