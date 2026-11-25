import AICore
import AppKit
import Carbon.HIToolbox

/// The selection toolbar over text selected in other apps (grill decisions Q4–Q8).
///
/// While it is on (the page's `toolbar.set`) and the app is trusted for Accessibility, a global
/// monitor watches mouse-ups in other apps. One that may have ended a text selection (a drag, a
/// double or triple click, a shift-click: ``SelectionGesture``) and that the activation admits
/// (``SelectionActivation``: always, the key combination held at the press or the release, or
/// while the `toggle` mode listens, ``SelectionToolbarListening``) is checked — unless
/// ``SelectionToolbarRules`` rules it out (excluded app, secure input, this app) — by asking
/// Accessibility off the main thread whether the focused element has a selection
/// (``SelectionPresence``, never the text). A selection shows the toolbar beside it. A drag or
/// shift-click is asked at once and, finding nothing, once more after ``debounce`` (web content
/// updates its selection late); a double click waits ``debounce`` first, so one that becomes a
/// triple asks once.
/// A plain click is checked only for a cell selection; it never shows over a text caret.
///
/// ``SelectionToolbarProbeRunner`` records `< 1 µs` zero-allocation `SelectionDecisionRing` traces
/// (including `watchInterruptions` debounce cancellation attribution) and drives the 6-step
/// selection live probe when armed.
final class SelectionToolbarController {
  /// Ask Atd was clicked, with the practice text when the toolbar was the guide's (nil for a
  /// selection in another app); the toolbar is already hidden.
  var onAsk: ((String?) -> Void)?
  /// A command button or a row of the More menu was clicked on a toolbar over another app's
  /// selection, launching the command as given; the toolbar and the menu are already hidden.
  var onCommand: ((CommandLaunch) -> Void)?
  /// A value of command `id` changed in its options menu over another app's selection, to be
  /// remembered for its next run; a practice toolbar's picks are not.
  var onPick: ((String, CommandArguments) -> Void)?

  static let debounce: Duration = .milliseconds(150)

  private let trust: AccessibilityTrust
  let probeRunner: SelectionToolbarProbeRunner
  private let panel = SelectionToolbarPanel()
  /// Nil until the page first pushes the setting.
  private var settings: SelectionToolbarSettings?
  private var monitor: Any?
  /// Keys, scrolls and other buttons, watched only while a check is pending or the toolbar shows.
  private var interruptMonitor: Any?
  private var activationObserver: NSObjectProtocol?
  private var pressedAt: CGPoint?
  private var pressedTime: TimeInterval = 0
  /// The activation key combination was down when the last press went down.
  private var heldAtPress = false
  private let listening = SelectionToolbarListening()
  private let hud = SelectionToolbarHUD()
  /// Bumped by every press, key, scroll and app switch, so a check that started before one is
  /// dropped.
  private var generation = 0
  private var pending: Task<Void, Never>?
  private let practice = SelectionToolbarPractice()
  private let wps: WpsSelectionAdapter

  init(trust: AccessibilityTrust, services: ShellServices) {
    self.trust = trust
    let wpsAdapter = WpsSelectionAdapter(services: services)
    self.wps = wpsAdapter
    self.probeRunner = SelectionToolbarProbeRunner(
      ring: services.decisionRings.selection, wps: wpsAdapter)
    panel.onAsk = { [weak self] in
      let text = self?.practice.text
      self?.dismiss()
      self?.onAsk?(text)
    }
    panel.onCommand = { [weak self] launch in
      let isPractice = self?.practice.text != nil
      self?.dismiss()
      if !isPractice { self?.onCommand?(launch) }
    }
    panel.onPick = { [weak self] id, values in
      if self?.practice.text == nil { self?.onPick?(id, values) }
    }
    listening.onChange = { [weak self] on in
      self?.hud.setListening(on)
      if !on { self?.dismiss() }
    }
  }

  var diagnosticsSnapshot: DiagnosticsEnvironmentRecord.SelectionToolbarSnapshotRecord {
    SelectionToolbarProbeRunner.makeSnapshot(
      settings: settings, isListening: isListening, monitorInstalled: monitor != nil)
  }

  func hudYields(_ yields: Bool) { hud.setYielding(yields) }
  func setAddons(_ installs: AddonInstalls) { wps.apply(installs) }
  /// Whether the `toggle` mode listens for selections, or nil while it is not in effect.
  var isListening: Bool? { listening.isArmed ? listening.isOn : nil }
  func setListening(_ on: Bool) { listening.set(on) }
  func setCommandOptions(_ catalog: CommandOptionsCatalog) { panel.setCommandOptions(catalog) }

  func apply(_ settings: SelectionToolbarSettings) {
    self.settings = settings
    panel.configure(settings)
    hud.configure(enabled: settings.showHud, keys: settings.activation.keys)
    update()
  }

  func update() {
    let active = settings?.enabled == true && trust.isTrusted
    if active, monitor == nil { install() } else if !active, monitor != nil { uninstall() }
    let activation = settings?.activation
    listening.arm(active && activation?.mode == .toggle ? activation?.keys : nil)
  }

  // MARK: Practice

  func showPractice(selection: CGRect, text: String) {
    guard let settings, settings.enabled, trust.isTrusted else { return hidePractice() }
    let held = settings.activation.isHeld(in: NSEvent.modifierFlags)
    guard
      settings.activation.admits(heldAtPress: held, heldAtRelease: held, listening: listening.isOn)
    else { return hidePractice() }
    dismiss()
    practice.show(selection: selection, text: text, panel: panel)
  }

  func hidePractice() {
    if practice.text != nil { dismiss() }
  }

  // MARK: Monitoring

  private func install() {
    if let app = NSWorkspace.shared.frontmostApplication {
      SelectionPresence.prepare(pid: app.processIdentifier, bundleURL: app.bundleURL)
    }
    monitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp]) {
      [weak self] event in
      MainActor.assumeIsolated { self?.handle(event) }
    }
    activationObserver = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
    ) { [weak self] note in
      let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
      let pid = app?.processIdentifier
      MainActor.assumeIsolated { self?.appActivated(pid: pid) }
    }
  }

  private func appActivated(pid: pid_t?) {
    dismiss(interruptedBy: .appActivated)
    guard let settings, let pid, let app = NSRunningApplication(processIdentifier: pid),
      SelectionToolbarRules.shouldProbe(context(of: app, settings))
    else { return }
    SelectionPresence.prepare(pid: pid, bundleURL: app.bundleURL)
  }

  private func context(of app: NSRunningApplication, _ settings: SelectionToolbarSettings)
    -> SelectionToolbarContext
  {
    SelectionToolbarContext(
      enabled: settings.enabled, trusted: trust.isTrusted,
      frontmostBundleId: app.bundleIdentifier, ownBundleId: Bundle.main.bundleIdentifier,
      excludedBundleIds: settings.excludedBundleIds, secureInput: IsSecureEventInputEnabled())
  }

  private func uninstall() {
    if let monitor { NSEvent.removeMonitor(monitor) }
    monitor = nil
    if let activationObserver {
      NSWorkspace.shared.notificationCenter.removeObserver(activationObserver)
    }
    activationObserver = nil
    dismiss()
  }

  private func handle(_ event: NSEvent) {
    guard let location = event.cgEvent?.location else {
      if event.type == .leftMouseUp {
        probeRunner.recordMissingCgLocation(trusted: trust.isTrusted)
      }
      return
    }
    let pointer = CaptureCoordinates.flip(
      location, primaryHeight: NSScreen.screens.first?.frame.height ?? 0)
    switch event.type {
    case .leftMouseDown:
      dismiss(interruptedBy: .mouseDown)
      pressedAt = pointer
      pressedTime =
        Date().timeIntervalSince1970 - ProcessInfo.processInfo.systemUptime + event.timestamp
      heldAtPress = held(in: event)
    case .leftMouseUp:
      let shiftHeld = event.modifierFlags.contains(.shift)
      let selected = SelectionGesture.mayHaveSelected(
        down: pressedAt, up: pointer, clickCount: event.clickCount, shift: shiftHeld)
      let heldAtRelease = held(in: event)
      let wasHeldAtPress = heldAtPress
      let admitted =
        settings?.activation.admits(
          heldAtPress: wasHeldAtPress, heldAtRelease: heldAtRelease, listening: listening.isOn)
        ?? false
      let origin = pressedAt ?? pointer
      let startedAt = pressedAt == nil ? Date().timeIntervalSince1970 : pressedTime
      let downPoint = pressedAt
      pressedAt = nil
      heldAtPress = false
      let token = generation
      guard
        let recorded = probeRunner.recordMouseUp(
          SelectionToolbarProbeRunner.GestureInput(
            pointer: pointer, pressedAt: downPoint, clickCount: event.clickCount,
            shiftHeld: shiftHeld, mayHaveSelected: selected, heldAtPress: wasHeldAtPress,
            heldAtRelease: heldAtRelease, listeningOn: listening.isOn, admitted: admitted,
            settings: settings, trusted: trust.isTrusted),
          token: token)
      else { return }
      schedule(
        slot: recorded.slot, seq: recorded.seq, at: pointer, origin: origin,
        startedAt: startedAt, immediately: event.clickCount < 2, cellsOnly: !selected)
    default:
      dismiss()
    }
  }

  private func held(in event: NSEvent) -> Bool {
    settings?.activation.isHeld(in: event.modifierFlags) ?? false
  }

  private func schedule(
    slot: Int, seq: UInt32, at pointer: CGPoint, origin: CGPoint, startedAt: TimeInterval,
    immediately: Bool, cellsOnly: Bool
  ) {
    pending?.cancel()
    watchInterruptions()
    let token = generation
    pending = Task { [weak self] in
      if immediately,
        await self?.check(
          attemptIndex: 0, slot: slot, seq: seq, pointer: pointer, origin: origin,
          startedAt: startedAt, token: token, cellsOnly: cellsOnly) == true
      {
        return
      }
      try? await Task.sleep(for: Self.debounce)
      guard !Task.isCancelled else { return }
      let shown =
        await self?.check(
          attemptIndex: 1, slot: slot, seq: seq, pointer: pointer, origin: origin,
          startedAt: startedAt, token: token, cellsOnly: cellsOnly) == true
      if !shown, token == self?.generation { self?.stopWatchingInterruptions() }
    }
  }

  private func watchInterruptions() {
    guard interruptMonitor == nil else { return }
    let mask: NSEvent.EventTypeMask = [.rightMouseDown, .otherMouseDown, .keyDown, .scrollWheel]
    interruptMonitor = NSEvent.addGlobalMonitorForEvents(matching: mask) { [weak self] event in
      let cause = SelectionToolbarProbeRunner.InterruptionCause.from(eventType: event.type)
      MainActor.assumeIsolated { self?.dismiss(interruptedBy: cause) }
    }
  }

  private func stopWatchingInterruptions() {
    if let interruptMonitor { NSEvent.removeMonitor(interruptMonitor) }
    interruptMonitor = nil
  }

  @discardableResult
  private func check(
    attemptIndex: Int, slot: Int, seq: UInt32, pointer: CGPoint, origin: CGPoint,
    startedAt: TimeInterval, token: Int, cellsOnly: Bool
  ) async -> Bool {
    guard token == generation, let settings else { return false }
    let outcome = await probeRunner.performProbeAttempt(
      attemptIndex: attemptIndex, slot: slot, seq: seq, origin: origin, startedAt: startedAt,
      token: token, cellsOnly: cellsOnly, settings: settings, trusted: trust.isTrusted
    ) { [weak self] expectedPid in
      guard let self, self.generation == token, self.monitor != nil else { return false }
      return NSWorkspace.shared.frontmostApplication?.processIdentifier == expectedPid
    }
    guard outcome.shouldShow else { return false }
    panel.show(selection: outcome.bounds, pointer: pointer)
    return true
  }

  private func dismiss(
    interruptedBy cause: SelectionToolbarProbeRunner.InterruptionCause = .none
  ) {
    probeRunner.recordInterruption(cause, currentToken: generation)
    generation += 1
    pending?.cancel()
    pending = nil
    practice.clear()
    stopWatchingInterruptions()
    panel.hide()
  }
}
