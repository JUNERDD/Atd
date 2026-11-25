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

  /// What user or system action triggered a non-cancelled capture completion (encoded in
  /// `CaptureAndArbiterEntry.flags` and appended to `ownerSummary` when known).
  enum FinishTrigger: UInt8 {
    case unknown = 0
    case returnKey = 1
    case doubleClick = 2
    case commandShortcut = 3
    case toolbarButton = 4
    case repeatShortcut = 5
    case commandSlot = 6
    case system = 7

    var code: String? {
      switch self {
      case .unknown: nil
      case .returnKey: "return"
      case .doubleClick: "double_click"
      case .commandShortcut: "shortcut"
      case .toolbarButton: "toolbar"
      case .repeatShortcut: "repeat_shortcut"
      case .commandSlot: "command_slot"
      case .system: "system"
      }
    }
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
      entry.flags = summary.flags
      ring.append(entry)
    }
    options.onLiveProbeCapture?(summary.liveGateCode)
  }

  private func outcomeSummary(_ outcome: Outcome) -> (
    code: String, liveGateCode: String, ringOutcome: UInt8, widthPx: UInt16, heightPx: UInt16,
    flags: UInt8
  ) {
    func triggeredCode(_ base: String) -> String {
      if let trigger = finishTrigger.code { return "\(base):\(trigger)" }
      return base
    }
    switch outcome {
    case .cancelled:
      let flags = cancelSource.rawValue
      switch cancelSource {
      case .user:
        return ("capture:cancelled_user", "cancelled_by_user", 0, 0, 0, flags)
      case .screenParametersChanged:
        return ("capture:cancelled_screen_change", "cancelled_screen_parameters", 1, 0, 0, flags)
      case .appResignedActive:
        return ("capture:cancelled_resigned_active", "cancelled_resigned_active", 1, 0, 0, flags)
      case .shortcutHandoffAborted:
        return ("capture:cancelled_handoff", "cancelled_shortcut_handoff", 1, 0, 0, flags)
      }
    case .wantsAccessibility:
      return ("capture:wants_accessibility", "wants_accessibility", 1, 0, 0, 0)
    case .confirmed(let c):
      return (
        triggeredCode("capture:confirmed"), "session_confirmed", 0,
        UInt16(clamping: c.image.width), UInt16(clamping: c.image.height), finishTrigger.rawValue
      )
    case .copied(let c):
      return (
        triggeredCode("capture:copied"), "session_copied", 0,
        UInt16(clamping: c.image.width), UInt16(clamping: c.image.height), finishTrigger.rawValue
      )
    case .saved(let c, _):
      return (
        triggeredCode("capture:saved"), "session_saved", 0,
        UInt16(clamping: c.image.width), UInt16(clamping: c.image.height), finishTrigger.rawValue
      )
    case .pinned(let c):
      return (
        triggeredCode("capture:pinned"), "session_pinned", 0,
        UInt16(clamping: c.image.width), UInt16(clamping: c.image.height), finishTrigger.rawValue
      )
    case .launched(let c, _):
      return (
        triggeredCode("capture:launched"), "session_launched", 0,
        UInt16(clamping: c.image.width), UInt16(clamping: c.image.height), finishTrigger.rawValue
      )
    case .record:
      return (
        triggeredCode("capture:handoff_recording"), "recording_started", 0, 0, 0,
        finishTrigger.rawValue
      )
    case .longScreenshot(let s):
      return (
        triggeredCode("capture:long_screenshot_done"), "long_screenshot_completed", 0,
        UInt16(clamping: s.image.width), UInt16(clamping: s.image.height), finishTrigger.rawValue
      )
    case .copiedLongScreenshot(let s):
      return (
        triggeredCode("capture:long_screenshot_copied"), "long_screenshot_copied", 0,
        UInt16(clamping: s.image.width), UInt16(clamping: s.image.height), finishTrigger.rawValue
      )
    case .savedLongScreenshot(let s):
      return (
        triggeredCode("capture:long_screenshot_saved"), "long_screenshot_saved", 0,
        UInt16(clamping: s.image.width), UInt16(clamping: s.image.height), finishTrigger.rawValue
      )
    case .textResult:
      return ("capture:text_result", "text_command_completed", 0, 0, 0, 0)
    case .failed:
      return ("capture:failed", "capture_failed", 2, 0, 0, 0)
    }
  }
}
