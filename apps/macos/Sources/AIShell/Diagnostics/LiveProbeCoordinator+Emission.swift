import AICore
import AppKit
import Carbon.HIToolbox
import CoreGraphics
import Foundation

extension LiveProbeCoordinator {
  func shouldEmit(force: Bool) -> Bool {
    guard var session = active else { return false }
    let now = ContinuousClock.now
    if !force, let last = session.lastPushInstant, now - last < Self.throttleInterval {
      return false
    }
    session.lastPushInstant = now
    active = session
    return true
  }

  func remainingMs(for reason: TerminalReason) -> Int {
    guard reason == .running, let session = active else { return 0 }
    let d = ContinuousClock.now.duration(to: session.deadline)
    let ms =
      Double(d.components.seconds) * 1_000.0
      + Double(d.components.attoseconds) / 1_000_000_000_000_000.0
    return min(10_000, max(0, Int(ms.rounded())))
  }

  func emitSelection(
    probeId: String, reason: TerminalReason, axTrusted: Bool, rawBundleId: String?,
    excluded: Bool, axRole: String?, selectedLength: Int, gateOutcome: String, force: Bool
  ) {
    guard active?.probeId == probeId, shouldEmit(force: force) else { return }
    let ended: DiagnosticsLiveProbeEventEvent.Selection.EndedReason =
      switch reason {
      case .running: .running
      case .timeout: .timeout
      case .stopped: .stopped
      case .windowClosed: .windowClosed
      }
    let event = DiagnosticsLiveProbeEventEvent.selection(
      .init(
        probeId: probeId,
        ts: Self.nowIso(),
        remainingMs: remainingMs(for: reason),
        endedReason: ended,
        axTrusted: axTrusted,
        frontmostBundleId: BundleIdentifierRedactor.redact(rawBundleId),
        excludedByAppRule: excluded,
        axRole: axRole,
        selectedLength: max(0, selectedLength),
        gateOutcome: gateOutcome))
    deliver(event, reason: reason)
  }

  func emitHotkey(
    probeId: String, reason: TerminalReason, matchedShortcutId: String?, modifierMask: Int,
    handoffOutcome: String, force: Bool
  ) {
    guard active?.probeId == probeId, shouldEmit(force: force) else { return }
    let ended: DiagnosticsLiveProbeEventEvent.Hotkey.EndedReason =
      switch reason {
      case .running: .running
      case .timeout: .timeout
      case .stopped: .stopped
      case .windowClosed: .windowClosed
      }
    let event = DiagnosticsLiveProbeEventEvent.hotkey(
      .init(
        probeId: probeId,
        ts: Self.nowIso(),
        remainingMs: remainingMs(for: reason),
        endedReason: ended,
        secureInputEnabled: IsSecureEventInputEnabled(),
        postEventTrusted: CGPreflightPostEventAccess(),
        globalMonitorActive: active?.shell?.registrar?.hasGlobalMonitor == true,
        matchedShortcutId: matchedShortcutId,
        modifierFlagsMask: max(0, modifierMask),
        handoffOutcome: handoffOutcome))
    deliver(event, reason: reason)
  }

  func emitCapture(
    probeId: String, reason: TerminalReason, gateOutcome: String, force: Bool
  ) {
    guard let session = active, session.probeId == probeId, shouldEmit(force: force) else {
      return
    }
    let ended: DiagnosticsLiveProbeEventEvent.Capture.EndedReason =
      switch reason {
      case .running: .running
      case .timeout: .timeout
      case .stopped: .stopped
      case .windowClosed: .windowClosed
      }
    let arbiter = session.shell?.deviceArbiter
    let heldSummaries = arbiter?.heldResourceSummaries() ?? []
    let ownerSummary =
      heldSummaries.isEmpty
      ? nil
      : DiagnosticsScrubber.scrubInlineSummary(
        heldSummaries.joined(separator: ", "), maxUTF8Bytes: 120)
    let event = DiagnosticsLiveProbeEventEvent.capture(
      .init(
        probeId: probeId,
        ts: Self.nowIso(),
        remainingMs: remainingMs(for: reason),
        endedReason: ended,
        screenRecordingTrusted: CGPreflightScreenCaptureAccess(),
        displayCount: min(16, NSScreen.screens.count),
        sdrFreezeReady: session.cachedSdrFreezeReady,
        arbiterInteractiveHeld: arbiter?.isHeld(.interactiveScreen) == true,
        heldOwnerSummary: ownerSummary,
        gateOutcome: gateOutcome))
    deliver(event, reason: reason)
  }

  private func deliver(_ event: DiagnosticsLiveProbeEventEvent, reason: TerminalReason) {
    onEventForTesting?(event)
    if reason != .windowClosed, let host = active?.host, !host.isClosed {
      host.send(.diagnosticsLiveProbeEvent(event), scope: .document)
    }
  }

  /// Checks whether `DisplayFreezer` can produce a valid SDR frame, releasing the `CGImage`
  /// immediately inside `autoreleasepool` so `0 B` of screen pixels are retained (`02` §3.4).
  static func probeSingleDisplayFreezeReadiness() async -> Bool {
    guard CGPreflightScreenCaptureAccess(), !NSScreen.screens.isEmpty else { return false }
    guard let freezer = try? await DisplayFreezer.prepare(),
      let firstTarget = freezer.targets.first
    else { return false }
    let frozen = try? await freezer.freeze(firstTarget)
    return autoreleasepool {
      guard let img = frozen?.image else { return false }
      return img.width > 0 && img.height > 0
    }
  }

  private static func nowIso() -> String {
    DiagnosticsTimestamp.iso8601UTC()
  }
}
