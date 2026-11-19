import AICore
import AppKit

/// Coarse lifecycle telemetry and observer wiring for ``CaptureSession`` (`01` §4.4 & `02` §3.4).
///
/// Strictly records coarse session start/freeze/finish transitions into ``CaptureAndArbiterRing``
/// (`0 B` pixel retention, zero 60 fps frame-stream hooks).
extension CaptureSession {
  enum CancelSource: UInt8 {
    case user = 0
    case screenParametersChanged = 1
    case appResignedActive = 2
    case shortcutHandoffAborted = 3
  }

  func installLifecycleObservers() {
    let center = NotificationCenter.default
    observers.append(
      center.addObserver(
        forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated { self?.cancel(source: .screenParametersChanged) }
      })
    observers.append(
      center.addObserver(
        forName: NSApplication.didResignActiveNotification, object: nil, queue: .main
      ) { [weak self] _ in
        Task { @MainActor [weak self] in
          guard let self, !self.isFinished, !NSApp.isActive, self.hasKeyboard,
            !self.passesInputThrough, !self.choosingSaveDestination
          else { return }
          self.cancel(source: .appResignedActive)
        }
      })
  }

  func cancel(source: CancelSource) {
    cancelSource = source
    finish(.cancelled)
  }

  func recordDisplayFreeze(
    elapsedMs: UInt16,
    sdrValid: Bool,
    targetCount: Int,
    screenCount: Int,
    imageSize: (width: Int, height: Int)?
  ) {
    let unmatched = max(0, screenCount - targetCount)
    if let ring = options.decisionRing {
      var entry = CaptureAndArbiterEntry()
      entry.uptimeNs = MonotonicTimestampAnchor.nowUptimeNs()
      entry.ownerSummary = InlineText64(
        truncatingUTF8: sdrValid ? "capture:display_frozen" : "capture:sdr_image_nil")
      entry.freezeMs = elapsedMs
      entry.widthPx = UInt16(clamping: imageSize?.width ?? 0)
      entry.heightPx = UInt16(clamping: imageSize?.height ?? 0)
      entry.eventKind = 4
      entry.outcome = sdrValid ? 0 : 2
      entry.displayCount = UInt8(clamping: max(0, screenCount))
      entry.unmatchedDisplayCount = UInt8(clamping: unmatched)
      ring.append(entry)
    }
    options.onLiveProbeCapture?(sdrValid ? "display_frozen" : "sdr_freeze_nil")
  }

  func recordSessionFinish(_ outcome: Outcome) {
    let summary = outcomeSummary(outcome)
    if let ring = options.decisionRing {
      var entry = CaptureAndArbiterEntry()
      entry.uptimeNs = MonotonicTimestampAnchor.nowUptimeNs()
      entry.ownerSummary = InlineText64(truncatingUTF8: summary.code)
      entry.widthPx = summary.widthPx
      entry.heightPx = summary.heightPx
      entry.eventKind = 5
      entry.outcome = summary.ringOutcome
      entry.displayCount = UInt8(clamping: overlays.count)
      entry.flags = cancelSource.rawValue
      ring.append(entry)
    }
    options.onLiveProbeCapture?(summary.liveGateCode)
  }

  private func outcomeSummary(_ outcome: Outcome) -> (
    code: String, liveGateCode: String, ringOutcome: UInt8, widthPx: UInt16, heightPx: UInt16
  ) {
    switch outcome {
    case .cancelled:
      switch cancelSource {
      case .user:
        ("capture:cancelled_user", "cancelled_by_user", 0, 0, 0)
      case .screenParametersChanged:
        ("capture:cancelled_screen_change", "cancelled_screen_parameters", 1, 0, 0)
      case .appResignedActive:
        ("capture:cancelled_resigned_active", "cancelled_resigned_active", 1, 0, 0)
      case .shortcutHandoffAborted:
        ("capture:cancelled_handoff", "cancelled_shortcut_handoff", 1, 0, 0)
      }
    case .wantsAccessibility:
      ("capture:wants_accessibility", "wants_accessibility", 1, 0, 0)
    case .confirmed(let c), .copied(let c), .saved(let c, _), .pinned(let c), .launched(let c, _):
      (
        "capture:confirmed", "session_confirmed", 0,
        UInt16(clamping: c.image.width), UInt16(clamping: c.image.height)
      )
    case .record:
      ("capture:handoff_recording", "recording_started", 0, 0, 0)
    case .longScreenshot(let s), .copiedLongScreenshot(let s), .savedLongScreenshot(let s):
      (
        "capture:long_screenshot_done", "long_screenshot_completed", 0,
        UInt16(clamping: s.image.width), UInt16(clamping: s.image.height)
      )
    case .textResult:
      ("capture:text_result", "text_command_completed", 0, 0, 0)
    case .failed:
      ("capture:failed", "capture_failed", 2, 0, 0)
    }
  }
}
