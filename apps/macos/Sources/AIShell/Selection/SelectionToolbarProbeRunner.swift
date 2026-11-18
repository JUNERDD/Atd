import AICore
import AppKit
import Carbon.HIToolbox

/// Zero-allocation `< 1 µs` `SelectionDecisionRing` recorder, 150ms debounce in-place updater, and
/// 6-step Live Probe event emitter extracted from ``SelectionToolbarController`` (`01` §4.2 &
/// `02` §3.2).
///
/// When no live probe is active, `onLiveProbeStep` is `nil` (`0 ns` idle overhead), and hot-path
/// `leftMouseUp` / interruption writes mutate fixed-size `BitwiseCopyable` structs in place without
/// heap string interpolation or `AXUIElement` retention.
final class SelectionToolbarProbeRunner {
  private struct ActiveAttempt {
    let slot: Int
    let seq: UInt32
    let startedUptimeNs: UInt64
    let token: Int
    let axTrusted: Bool
    let redactedBundleId: String?
    let excludedByAppRule: Bool
  }

  let ring: SelectionDecisionRing
  private let wps: WpsSelectionAdapter
  var onLiveProbeStep: ((LiveStep) -> Void)?
  private var activeAttempt: ActiveAttempt?

  init(ring: SelectionDecisionRing, wps: WpsSelectionAdapter) {
    self.ring = ring
    self.wps = wps
  }

  @inline(__always)
  func recordMissingCgLocation(trusted: Bool) {
    var entry = SelectionDecisionEntry()
    entry.uptimeNs = MonotonicTimestampAnchor.nowUptimeNs()
    if trusted { entry.flags |= SelectionGateFlags.trusted.rawValue }
    entry.dropStage = 1
    ring.append(entry)
    if let onLiveProbeStep {
      onLiveProbeStep(
        LiveStep(
          axTrusted: trusted, frontmostBundleId: nil, excludedByAppRule: false,
          axRole: nil, selectedLength: 0, gateOutcome: "missing_cg_location"))
    }
  }

  /// Records a `leftMouseUp` gesture in `< 250 ns` and returns `(slot, seq)` when admitted for AX
  /// probing, or `nil` when gated out beforehand.
  func recordMouseUp(_ input: GestureInput, token: Int) -> (slot: Int, seq: UInt32)? {
    let nowNs = MonotonicTimestampAnchor.nowUptimeNs()
    let app = NSWorkspace.shared.frontmostApplication
    let secure = IsSecureEventInputEnabled()
    let bundleId = app?.bundleIdentifier
    let ownBundleId = Bundle.main.bundleIdentifier

    var flags: SelectionGateFlags = [.hadCgLocation]
    if input.pressedAt != nil { flags.insert(.hadMouseDown) }
    if input.shiftHeld { flags.insert(.shiftHeld) }
    if input.mayHaveSelected { flags.insert(.mayHaveSelected) } else { flags.insert(.cellsOnly) }
    if input.heldAtPress { flags.insert(.heldAtPress) }
    if input.heldAtRelease { flags.insert(.heldAtRelease) }
    if input.listeningOn { flags.insert(.toggleListening) }
    if input.admitted { flags.insert(.admitted) }
    if input.trusted { flags.insert(.trusted) }
    if secure { flags.insert(.secureInput) }

    var entry = SelectionDecisionEntry()
    entry.uptimeNs = nowNs
    entry.frontmostBundleId = InlineText64(truncatingUTF8: bundleId)
    entry.frontmostPid = app?.processIdentifier ?? 0
    entry.flags = flags.rawValue
    if let down = input.pressedAt {
      let deciPt = Int((hypot(input.pointer.x - down.x, input.pointer.y - down.y) * 10.0).rounded())
      entry.dragDistanceDeciPt = UInt16(clamping: max(0, deciPt))
    }
    entry.clickCount = UInt8(clamping: max(0, input.clickCount))
    entry.activationMode = Self.encodeActivation(input.settings?.activation.mode)

    let isOwnApp = bundleId != nil && bundleId == ownBundleId
    let isExcluded =
      bundleId.map { input.settings?.excludedBundleIds.contains($0) == true } ?? false
    entry.appFilter = input.settings == nil ? 3 : (isOwnApp ? 1 : (isExcluded ? 2 : 0))

    if !input.admitted {
      entry.dropStage = 2
      ring.append(entry)
      emitLive(
        trusted: input.trusted, bundleId: bundleId, excluded: isExcluded,
        role: nil, length: 0, outcome: "activation_blocked")
      return nil
    }
    if input.settings?.enabled != true || !input.trusted {
      entry.dropStage = 3
      ring.append(entry)
      emitLive(
        trusted: input.trusted, bundleId: bundleId, excluded: isExcluded,
        role: nil, length: 0,
        outcome: input.trusted ? "toolbar_disabled" : "accessibility_untrusted")
      return nil
    }
    if secure || isOwnApp || isExcluded {
      entry.dropStage = secure ? 4 : (isExcluded ? 5 : 6)
      ring.append(entry)
      let code =
        secure ? "secure_input_active" : (isExcluded ? "excluded_app" : "ignored_own_window")
      emitLive(
        trusted: input.trusted, bundleId: bundleId, excluded: isExcluded,
        role: nil, length: 0, outcome: code)
      return nil
    }

    let recorded = ring.append(entry)
    activeAttempt = ActiveAttempt(
      slot: recorded.slot,
      seq: recorded.seq,
      startedUptimeNs: nowNs,
      token: token,
      axTrusted: input.trusted,
      redactedBundleId: onLiveProbeStep != nil ? BundleIdentifierRedactor.redact(bundleId) : nil,
      excludedByAppRule: isExcluded)
    return recorded
  }

  func recordInterruption(_ cause: InterruptionCause, currentToken: Int) {
    guard let active = activeAttempt, active.token == currentToken, cause != .none else { return }
    activeAttempt = nil
    let nowNs = MonotonicTimestampAnchor.nowUptimeNs()
    let afterMs = UInt16(clamping: (nowNs &- active.startedUptimeNs) / 1_000_000)
    ring.update(slot: active.slot, expectedSeq: active.seq) { entry in
      entry.debounceState = 2
      entry.interruptedBy = cause.rawValue
      entry.interruptedAfterMs = afterMs
      if (entry.flags & SelectionGateFlags.shown.rawValue) == 0 {
        entry.dropStage = 7
      }
    }
    if let onLiveProbeStep {
      onLiveProbeStep(
        LiveStep(
          axTrusted: active.axTrusted,
          frontmostBundleId: active.redactedBundleId,
          excludedByAppRule: active.excludedByAppRule,
          axRole: nil,
          selectedLength: 0,
          gateOutcome: cause.gateOutcomeCode))
    }
  }

  func clearActiveAttempt(forToken token: Int) {
    if activeAttempt?.token == token { activeAttempt = nil }
  }

  /// Runs one AX probe pass (`attemptIndex`: `0` immediate or `1` after 150ms debounce) and updates
  /// the ring slot in place. Returns the resolved selection `bounds` when the toolbar should show.
  func performProbeAttempt(
    attemptIndex: Int,
    slot: Int,
    seq: UInt32,
    origin: CGPoint,
    startedAt: TimeInterval,
    token: Int,
    cellsOnly: Bool,
    settings: SelectionToolbarSettings,
    trusted: Bool,
    isStillCurrent: (_ expectedPid: pid_t) -> Bool
  ) async -> (shouldShow: Bool, bounds: CGRect?) {
    guard let app = NSWorkspace.shared.frontmostApplication else { return (false, nil) }
    let context = SelectionToolbarContext(
      enabled: settings.enabled, trusted: trusted, frontmostBundleId: app.bundleIdentifier,
      ownBundleId: Bundle.main.bundleIdentifier, excludedBundleIds: settings.excludedBundleIds,
      secureInput: IsSecureEventInputEnabled())
    guard SelectionToolbarRules.shouldProbe(context) else {
      ring.update(slot: slot, expectedSeq: seq) { entry in
        if context.secureInput { entry.flags |= SelectionGateFlags.secureInput.rawValue }
        entry.dropStage = context.secureInput ? 4 : 5
      }
      emitLive(
        trusted: trusted, bundleId: app.bundleIdentifier,
        excluded: settings.excludedBundleIds.contains(app.bundleIdentifier ?? ""),
        role: nil, length: 0,
        outcome: context.secureInput ? "secure_input_active" : "context_disallowed")
      return (false, nil)
    }

    let deadline = ContinuousClock.now + .milliseconds(300)
    let evidence = await wps.evidence(app: app, pressedAt: startedAt)
    guard !Task.isCancelled, ContinuousClock.now < deadline, isStillCurrent(app.processIdentifier)
    else { return (false, nil) }

    let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
    let (probe, trace) = await SelectionPresence.check(
      pid: app.processIdentifier,
      gestureAt: CaptureCoordinates.flip(origin, primaryHeight: primaryHeight),
      wps: evidence,
      limit: ContinuousClock.now.duration(to: deadline))

    guard isStillCurrent(app.processIdentifier) else { return (false, nil) }

    let permittedByGesture = !cellsOnly || probe == .cells
    let shows = permittedByGesture && SelectionToolbarRules.shows(probe)
    var selectionBounds: CGRect?
    var selectedLen = 0
    if case .selected(let len, let rect) = probe {
      selectedLen = max(0, len)
      selectionBounds = rect
    }

    ring.update(slot: slot, expectedSeq: seq) { entry in
      if trace.busyMutexSkipped { entry.flags |= SelectionGateFlags.busyMutexSkipped.rawValue }
      if selectionBounds != nil { entry.flags |= SelectionGateFlags.hasBounds.rawValue }
      let outcomeCode = Self.encodeProbeOutcome(probe)
      if attemptIndex == 0 {
        entry.attempt0Outcome = outcomeCode
        entry.attempt0Role = trace.roleCode
        entry.attempt0WebAttrs = trace.webAttrsMask
        entry.attempt0AxError = trace.lastAxError
        entry.attempt0ElapsedUs = trace.elapsedUs
        if !shows { entry.debounceState = 1 }
      } else {
        entry.debounceState = 3
        entry.attempt1Outcome = outcomeCode
        entry.attempt1AxError = trace.lastAxError
        entry.attempt1ElapsedUs = trace.elapsedUs
      }
      entry.selectionLengthBucket = Self.encodeLengthBucket(probe)
      if shows {
        entry.flags |= SelectionGateFlags.shown.rawValue
        entry.dropStage = 0
      } else if attemptIndex == 1 {
        entry.dropStage = !permittedByGesture ? 8 : 9
      }
    }

    if shows || attemptIndex == 1 { clearActiveAttempt(forToken: token) }

    if onLiveProbeStep != nil {
      let gateCode: String =
        if shows {
          "panel_shown"
        } else if probe == .secureField {
          "secure_text_field"
        } else if trace.lastAxError == Int16(AXError.apiDisabled.rawValue) {
          "ax_api_disabled"
        } else if trace.lastAxError == Int16(AXError.cannotComplete.rawValue) {
          "ax_timeout"
        } else if !permittedByGesture {
          "plain_click_no_cells"
        } else {
          attemptIndex == 0 ? "attempt0_empty_debouncing" : "ax_no_selection"
        }
      emitLive(
        trusted: trusted, bundleId: app.bundleIdentifier,
        excluded: settings.excludedBundleIds.contains(app.bundleIdentifier ?? ""),
        role: SelectionPresence.roleName(forCode: trace.roleCode),
        length: selectedLen, outcome: gateCode)
    }

    return (shows, selectionBounds)
  }

  private func emitLive(
    trusted: Bool, bundleId: String?, excluded: Bool, role: String?, length: Int, outcome: String
  ) {
    guard let onLiveProbeStep else { return }
    onLiveProbeStep(
      LiveStep(
        axTrusted: trusted, frontmostBundleId: BundleIdentifierRedactor.redact(bundleId),
        excludedByAppRule: excluded, axRole: role, selectedLength: max(0, length),
        gateOutcome: outcome))
  }
}
