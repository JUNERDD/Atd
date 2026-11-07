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
/// While the `toggle` mode listens, ``SelectionToolbarHUD`` says so near the bottom of the
/// screen (unless the page turned it off).
///
/// The toolbar goes on any key (Escape included), scroll or click elsewhere, and when another
/// app activates, and its menus and their submenus (``ToolbarOptionsCascade``, which never take
/// the keyboard either) go with it; the pointer wandering off never closes either, so the menu can reach
/// as far from the capsule as it needs. A newer press or key makes any check still running
/// stale. Only presses are watched all the time; keys, scrolls and other buttons are watched
/// while a check is pending or the toolbar shows, so typing and scrolling elsewhere never wake
/// the app. Without the setting or the trust, no monitor is installed.
///
/// ``SelectionToolbarPractice`` owns selections in the welcome guide itself. Activation still
/// gates those selections; their commands only hide the toolbar and Ask Atd quotes into a draft.
final class SelectionToolbarController {
  /// Ask Atd was clicked, with the practice text when the toolbar was the guide's (nil for a
  /// selection in another app); the toolbar is already hidden.
  var onAsk: ((String?) -> Void)?
  /// A command button or a row of the More menu was clicked on a toolbar over another app's
  /// selection, launching the command as given; the toolbar and the menu are already hidden. A
  /// practice toolbar's commands never get here: they would run.
  var onCommand: ((CommandLaunch) -> Void)?
  /// A value of command `id` changed in its options menu over another app's selection, to be
  /// remembered for its next run; a practice toolbar's picks are not.
  var onPick: ((String, CommandArguments) -> Void)?

  static let debounce: Duration = .milliseconds(150)

  private let trust: AccessibilityTrust
  private let wps: WpsSelectionAdapter
  private let panel = SelectionToolbarPanel()
  /// Nil until the page first pushes the setting.
  private var settings: SelectionToolbarSettings?
  private var monitor: Any?
  /// Keys, scrolls and other buttons, watched only while a check is pending or the toolbar
  /// shows: each makes a check stale or hides the toolbar.
  private var interruptMonitor: Any?
  /// Pointer moves over other apps, watched only while the toolbar shows: hover tracking pauses
  /// while the pointer rests away from the toolbar and its menu, and needs a move to resume.
  private var moveMonitor: Any?
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

  init(trust: AccessibilityTrust, services: ShellServices) {
    self.trust = trust
    wps = WpsSelectionAdapter(services: services)
    panel.onAsk = { [weak self] in
      let text = self?.practice.text
      self?.dismiss()
      self?.onAsk?(text)
    }
    panel.onCommand = { [weak self] launch in
      let practice = self?.practice.text != nil
      self?.dismiss()
      if !practice { self?.onCommand?(launch) }
    }
    panel.onPick = { [weak self] id, values in
      if self?.practice.text == nil { self?.onPick?(id, values) }
    }
    listening.onChange = { [weak self] on in
      self?.hud.setListening(on)
      if !on { self?.dismiss() }
    }
  }

  /// A command's progress HUD came onto the screen or left it; the status HUD, which shares its
  /// place, yields it meanwhile.
  func hudYields(_ yields: Bool) { hud.setYielding(yields) }

  func setAddons(_ installs: AddonInstalls) { wps.apply(installs) }

  /// Whether the `toggle` mode listens for selections, or nil while it is not in effect.
  var isListening: Bool? { listening.isArmed ? listening.isOn : nil }

  /// The status menu's way to turn the `toggle` mode's listening on or off.
  func setListening(_ on: Bool) { listening.set(on) }

  /// The page's `toolbar.set`.
  func apply(_ settings: SelectionToolbarSettings) {
    self.settings = settings
    panel.configure(settings)
    hud.configure(enabled: settings.showHud, keys: settings.activation.keys)
    update()
  }

  /// The page's `commandOptions.set`: the commands that get split buttons and options menus
  /// from the next time the toolbar shows.
  func setCommandOptions(_ catalog: CommandOptionsCatalog) {
    panel.setCommandOptions(catalog)
  }

  /// Installs the monitors exactly while the toolbar is on and trusted, and arms the `toggle`
  /// mode's listening only then.
  func update() {
    let active = settings?.enabled == true && trust.isTrusted
    if active, monitor == nil {
      install()
    } else if !active, monitor != nil {
      uninstall()
    }
    let activation = settings?.activation
    listening.arm(active && activation?.mode == .toggle ? activation?.keys : nil)
  }

  // MARK: Practice

  /// Shows the toolbar beside the guide's practice selection (`selection` in Cocoa global
  /// points) when the real one would show at all: the setting is on and the app is trusted.
  /// Otherwise any practice toolbar hides.
  func showPractice(selection: CGRect, text: String) {
    guard let settings, settings.enabled, trust.isTrusted else { return hidePractice() }
    let held = settings.activation.isHeld(in: NSEvent.modifierFlags)
    guard
      settings.activation.admits(heldAtPress: held, heldAtRelease: held, listening: listening.isOn)
    else { return hidePractice() }
    dismiss()
    practice.show(selection: selection, text: text, panel: panel)
  }

  /// Hides a practice toolbar; a toolbar over another app's selection stays.
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
      // `Notification` is not Sendable, so only the pid crosses into the main-actor handler.
      let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
      let pid = app?.processIdentifier
      MainActor.assumeIsolated { self?.appActivated(pid: pid) }
    }
  }

  /// Another app came forward: the toolbar over the last one goes, and an Electron app the
  /// toolbar would probe starts building its web accessibility tree now, so it has one by the
  /// time something is selected in it.
  private func appActivated(pid: pid_t?) {
    dismiss()
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
    guard let location = event.cgEvent?.location else { return }
    let pointer = CaptureCoordinates.flip(
      location, primaryHeight: NSScreen.screens.first?.frame.height ?? 0)
    switch event.type {
    case .leftMouseDown:
      dismiss()
      pressedAt = pointer
      // WPS may emit before this callback runs. Use the source event's uptime, not receipt time.
      pressedTime =
        Date().timeIntervalSince1970 - ProcessInfo.processInfo.systemUptime + event.timestamp
      heldAtPress = held(in: event)
    case .leftMouseUp:
      let selected = SelectionGesture.mayHaveSelected(
        down: pressedAt, up: pointer, clickCount: event.clickCount,
        shift: event.modifierFlags.contains(.shift))
      let admitted = settings?.activation.admits(
        heldAtPress: heldAtPress, heldAtRelease: held(in: event), listening: listening.isOn)
      // The press identifies the table even when a drag ends outside it. Without a recorded
      // press, only the release can associate this gesture with a surface.
      let origin = pressedAt ?? pointer
      let startedAt = pressedAt == nil ? Date().timeIntervalSince1970 : pressedTime
      pressedAt = nil
      heldAtPress = false
      if admitted == true {
        schedule(
          at: pointer, origin: origin, startedAt: startedAt,
          immediately: event.clickCount < 2, cellsOnly: !selected)
      }
    default:
      dismiss()
    }
  }

  /// Whether the activation key combination was down during `event`.
  private func held(in event: NSEvent) -> Bool {
    settings?.activation.isHeld(in: event.modifierFlags) ?? false
  }

  private func schedule(
    at pointer: CGPoint, origin: CGPoint, startedAt: TimeInterval, immediately: Bool,
    cellsOnly: Bool
  ) {
    pending?.cancel()
    watchInterruptions()
    let token = generation
    pending = Task { [weak self] in
      if immediately,
        await self?.check(
          pointer: pointer, origin: origin, startedAt: startedAt, token: token, cellsOnly: cellsOnly
        )
          == true
      {
        return
      }
      try? await Task.sleep(for: Self.debounce)
      guard !Task.isCancelled else { return }
      let shown =
        await self?.check(
          pointer: pointer, origin: origin, startedAt: startedAt, token: token, cellsOnly: cellsOnly
        )
        == true
      if !shown, token == self?.generation { self?.stopWatchingInterruptions() }
    }
  }

  private func watchInterruptions() {
    guard interruptMonitor == nil else { return }
    let mask: NSEvent.EventTypeMask = [.rightMouseDown, .otherMouseDown, .keyDown, .scrollWheel]
    interruptMonitor = NSEvent.addGlobalMonitorForEvents(matching: mask) { [weak self] _ in
      MainActor.assumeIsolated { self?.dismiss() }
    }
  }

  private func stopWatchingInterruptions() {
    if let interruptMonitor { NSEvent.removeMonitor(interruptMonitor) }
    interruptMonitor = nil
  }

  /// The rules first, then Accessibility, then the toolbar if nothing newer happened meanwhile.
  /// True when the toolbar showed.
  @discardableResult
  private func check(
    pointer: CGPoint, origin: CGPoint, startedAt: TimeInterval, token: Int, cellsOnly: Bool
  ) async -> Bool {
    guard token == generation, let settings,
      let app = NSWorkspace.shared.frontmostApplication
    else { return false }
    guard SelectionToolbarRules.shouldProbe(context(of: app, settings)) else { return false }
    let deadline = ContinuousClock.now + .milliseconds(300)
    let evidence = await wps.evidence(app: app, pressedAt: startedAt)
    guard token == generation, !Task.isCancelled, ContinuousClock.now < deadline,
      NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier
    else { return false }
    let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
    let probe = await SelectionPresence.check(
      pid: app.processIdentifier,
      gestureAt: CaptureCoordinates.flip(origin, primaryHeight: primaryHeight), wps: evidence,
      limit: ContinuousClock.now.duration(to: deadline))
    guard token == generation, monitor != nil,
      NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier,
      !cellsOnly || probe == .cells,
      SelectionToolbarRules.shows(probe)
    else { return false }
    var bounds: CGRect?
    if case .selected(_, let rect) = probe { bounds = rect }
    panel.show(selection: bounds, pointer: pointer)
    watchPointer()
    return true
  }

  // MARK: Dismissal

  /// Wakes hover tracking on pointer moves over other apps; the pointer's distance from the
  /// toolbar never dismisses it.
  private func watchPointer() {
    guard moveMonitor == nil else { return }
    moveMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) {
      [weak self] _ in
      MainActor.assumeIsolated { self?.panel.pointerMoved() }
    }
  }

  /// Hides the toolbar and drops any check still running.
  private func dismiss() {
    generation += 1
    pending?.cancel()
    pending = nil
    if let moveMonitor { NSEvent.removeMonitor(moveMonitor) }
    moveMonitor = nil
    practice.clear()
    stopWatchingInterruptions()
    panel.hide()
  }
}
