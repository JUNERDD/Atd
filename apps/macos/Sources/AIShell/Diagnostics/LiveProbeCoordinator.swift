import AICore
import AppKit
import Carbon.HIToolbox
import CoreGraphics
import Foundation

/// Coordinates the three mutually exclusive 10-second auto-disarming Live Probes (`selection`,
/// `hotkey`, `capture`) (`02-doctor-and-live-probes.md` §3 & `03` §3.2).
///
/// Invariants:
/// - `0 ns` steady-state overhead when idle (`active == nil`; zero background timers or extra
///   `NSEvent` monitors).
/// - Hard 10-second `ContinuousClock` auto-disarm watchdog, plus immediate disarm on `stop()` or
///   when the hosting Settings `WebViewHost` unloads / closes.
/// - Zero selected text, zero ordinary keystrokes (modifier flags & registered shortcut IDs only),
///   zero retained display pixels, and `frontmostBundleId` anonymized via
///   ``BundleIdentifierRedactor``.
final class LiveProbeCoordinator {
  enum TerminalReason {
    case running
    case timeout
    case stopped
    case windowClosed
  }

  struct ActiveSession {
    let probeId: String
    let kind: DiagnosticsLiveProbeStartParams.Kind
    let startedAt: ContinuousClock.Instant
    let deadline: ContinuousClock.Instant
    weak var host: WebViewHost?
    weak var shell: ShellController?
    var expiryTask: Task<Void, Never>?
    var preflightTask: Task<Void, Never>?
    var eventMonitors: [Any] = []
    var notificationObservers: [any NSObjectProtocol] = []
    var lastPushInstant: ContinuousClock.Instant?
    var cachedSdrFreezeReady = false
  }

  static let defaultDuration: Duration = .seconds(10)
  static let throttleInterval: Duration = .milliseconds(50)  // <= 20 Hz

  var active: ActiveSession?
  var onEventForTesting: ((DiagnosticsLiveProbeEventEvent) -> Void)?

  var isArmed: Bool { active != nil }
  var activeProbeId: String? { active?.probeId }

  func start(
    kind: DiagnosticsLiveProbeStartParams.Kind,
    host: WebViewHost?,
    shell: ShellController?,
    duration: Duration = LiveProbeCoordinator.defaultDuration
  ) -> DiagnosticsLiveProbeStartResult {
    stop()

    let probeId = "probe-\(UUID().uuidString.lowercased().prefix(12))"
    let now = ContinuousClock.now
    let clampedMs = min(
      10_000,
      max(
        1_000,
        Int(
          (Double(duration.components.seconds) * 1_000.0
            + Double(duration.components.attoseconds) / 1_000_000_000_000_000.0).rounded())))

    var session = ActiveSession(
      probeId: probeId,
      kind: kind,
      startedAt: now,
      deadline: now.advanced(by: duration),
      host: host,
      shell: shell)

    session.expiryTask = Task { [weak self] in
      try? await Task.sleep(for: duration, clock: .continuous)
      guard !Task.isCancelled else { return }
      self?.disarm(expectedProbeId: probeId, reason: .timeout)
    }

    active = session
    armHooks(for: kind, probeId: probeId, shell: shell)

    let resultKind: DiagnosticsLiveProbeStartResult.Kind =
      switch kind {
      case .selection: .selection
      case .hotkey: .hotkey
      case .capture: .capture
      }
    return DiagnosticsLiveProbeStartResult(
      probeId: probeId, kind: resultKind, durationMs: clampedMs)
  }

  /// Idempotent explicit stop (`diagnostics.liveProbe.stop`).
  func stop() {
    guard let current = active else { return }
    disarm(expectedProbeId: current.probeId, reason: .stopped)
  }

  /// Disarms immediately when the owning page unloads or its window closes.
  func windowDidClose(host: WebViewHost) {
    guard let current = active, current.host === host else { return }
    disarm(expectedProbeId: current.probeId, reason: .windowClosed)
  }

  private func armHooks(
    for kind: DiagnosticsLiveProbeStartParams.Kind,
    probeId: String,
    shell: ShellController?
  ) {
    switch kind {
    case .selection:
      let snap = shell?.toolbar.diagnosticsSnapshot
      let trusted = shell?.trust.isTrusted ?? AXIsProcessTrusted()
      let frontApp = NSWorkspace.shared.frontmostApplication
      let initialCode: String =
        if !trusted {
          "accessibility_untrusted"
        } else if snap?.settingsReceived == false {
          "settings_missing"
        } else if snap?.enabled == false {
          "toolbar_disabled"
        } else if IsSecureEventInputEnabled() {
          "secure_input_active"
        } else {
          "monitor_ready"
        }
      emitSelection(
        probeId: probeId, reason: .running, axTrusted: trusted,
        rawBundleId: frontApp?.bundleIdentifier, excluded: false, axRole: nil, selectedLength: 0,
        gateOutcome: initialCode, force: true)

      shell?.toolbar.probeRunner.onLiveProbeStep = { [weak self] step in
        self?.emitSelection(
          probeId: probeId, reason: .running, axTrusted: step.axTrusted,
          rawBundleId: step.frontmostBundleId, excluded: step.excludedByAppRule,
          axRole: step.axRole, selectedLength: step.selectedLength,
          gateOutcome: step.gateOutcome, force: true)
      }

    case .hotkey:
      emitHotkey(
        probeId: probeId, reason: .running, matchedShortcutId: nil,
        modifierMask: Int(HotKeyRegistrar.sanitizedModifierMask(NSEvent.modifierFlags)),
        handoffOutcome: "armed_waiting", force: true)

      shell?.registrar?.onLiveProbeShortcut = { [weak self] shortcutId, mask, outcome in
        self?.emitHotkey(
          probeId: probeId, reason: .running, matchedShortcutId: shortcutId, modifierMask: mask,
          handoffOutcome: outcome, force: true)
      }

      // Watch `.flagsChanged` ONLY: never observe ordinary `.keyDown` characters (`02` §3.3).
      let global = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { [weak self] ev in
        let mask = Int(HotKeyRegistrar.sanitizedModifierMask(ev.modifierFlags))
        MainActor.assumeIsolated {
          self?.emitHotkey(
            probeId: probeId, reason: .running, matchedShortcutId: nil, modifierMask: mask,
            handoffOutcome: "modifier_flags_changed", force: false)
        }
      }
      let local = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { [weak self] ev in
        let mask = Int(HotKeyRegistrar.sanitizedModifierMask(ev.modifierFlags))
        MainActor.assumeIsolated {
          self?.emitHotkey(
            probeId: probeId, reason: .running, matchedShortcutId: nil, modifierMask: mask,
            handoffOutcome: "modifier_flags_changed", force: false)
        }
        return ev
      }
      active?.eventMonitors = [global, local].compactMap(\.self)

    case .capture:
      emitCapture(probeId: probeId, reason: .running, gateOutcome: "probing_displays", force: true)
      shell?.deviceArbiter.onLiveProbeChange = { [weak self] in
        self?.emitCapture(
          probeId: probeId, reason: .running, gateOutcome: "arbiter_state_changed", force: false)
      }
      shell?.screenshots.onLiveProbeCapture = { [weak self] code in
        self?.emitCapture(probeId: probeId, reason: .running, gateOutcome: code, force: true)
      }
      let screenObs = NotificationCenter.default.addObserver(
        forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.emitCapture(
            probeId: probeId, reason: .running, gateOutcome: "display_parameters_changed",
            force: true)
        }
      }
      active?.notificationObservers = [screenObs]
      active?.preflightTask = Task { [weak self] in
        let sdrReady = await Self.probeSingleDisplayFreezeReadiness()
        guard !Task.isCancelled, let self, self.active?.probeId == probeId else { return }
        self.active?.cachedSdrFreezeReady = sdrReady
        let trusted = CGPreflightScreenCaptureAccess()
        let code =
          !trusted
          ? "screen_recording_untrusted" : (sdrReady ? "ready" : "sdr_freeze_unavailable")
        self.emitCapture(probeId: probeId, reason: .running, gateOutcome: code, force: true)
      }
    }
  }

  func disarm(expectedProbeId: String, reason: TerminalReason) {
    guard let session = active, session.probeId == expectedProbeId else { return }
    session.expiryTask?.cancel()
    session.preflightTask?.cancel()
    for monitor in session.eventMonitors { NSEvent.removeMonitor(monitor) }
    for obs in session.notificationObservers { NotificationCenter.default.removeObserver(obs) }
    session.shell?.toolbar.probeRunner.onLiveProbeStep = nil
    session.shell?.registrar?.onLiveProbeShortcut = nil
    session.shell?.deviceArbiter.onLiveProbeChange = nil
    session.shell?.screenshots.onLiveProbeCapture = nil

    switch session.kind {
    case .selection:
      emitSelection(
        probeId: session.probeId, reason: reason,
        axTrusted: session.shell?.trust.isTrusted ?? AXIsProcessTrusted(),
        rawBundleId: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
        excluded: false, axRole: nil, selectedLength: 0,
        gateOutcome: reason == .timeout ? "probe_completed" : "probe_stopped", force: true)
    case .hotkey:
      emitHotkey(
        probeId: session.probeId, reason: reason, matchedShortcutId: nil,
        modifierMask: Int(HotKeyRegistrar.sanitizedModifierMask(NSEvent.modifierFlags)),
        handoffOutcome: reason == .timeout ? "probe_completed" : "probe_stopped", force: true)
    case .capture:
      emitCapture(
        probeId: session.probeId, reason: reason,
        gateOutcome: reason == .timeout ? "probe_completed" : "probe_stopped", force: true)
    }
    active = nil
  }
}
