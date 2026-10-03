import AICore
import AppKit
import Carbon.HIToolbox

/// The selection toolbar over text selected in other apps (grill decisions Q4–Q8).
///
/// While it is on (the page's `toolbar.set`) and the app is trusted for Accessibility, a global
/// monitor watches mouse-ups in other apps. One that may have ended a selection (a drag, a
/// double or triple click, a shift-click: ``SelectionGesture``) is checked — unless
/// ``SelectionToolbarRules`` rules it out (excluded app, secure input, this app) — by asking
/// Accessibility off the main thread whether the focused element has a selection
/// (``SelectionPresence``, never the text). A selection shows the toolbar beside it. A drag or
/// shift-click is asked at once and, finding nothing, once more after ``debounce`` (web content
/// updates its selection late); a double click waits ``debounce`` first, so one that becomes a
/// triple asks once.
///
/// The toolbar goes when the pointer moves ``SelectionToolbarRules/dismissDistance`` away, on
/// any key (Escape included), scroll or click elsewhere, and when another app activates. A
/// newer press or key makes any check still running stale. Only presses are watched all the
/// time; keys, scrolls and other buttons are watched while a check is pending or the toolbar
/// shows, so typing and scrolling elsewhere never wake the app. Without the setting or the
/// trust, no monitor is installed.
///
/// The welcome guide's practice area shows the same toolbar over text selected in the guide
/// itself (``showPractice(selection:text:)``), which the global monitors never see: the guide's
/// page drives it, hiding it as its selection goes, so no pointer-away monitor watches it, and
/// its Ask Atd hands on the practice text, which no Accessibility read would find. The guide never
/// spends tokens, so a practice toolbar's commands only hide it; Ask Atd quotes the text into the
/// panel's draft and sends nothing.
final class SelectionToolbarController {
  /// Ask Atd was clicked, with the practice text when the toolbar was the guide's (nil for a
  /// selection in another app); the toolbar is already hidden.
  var onAsk: ((String?) -> Void)?
  /// A command button or More item was clicked on a toolbar over another app's selection; the
  /// toolbar is already hidden. A practice toolbar's commands never get here: they would run.
  var onCommand: ((String) -> Void)?

  static let debounce: Duration = .milliseconds(150)

  private let trust: AccessibilityTrust
  private let panel = SelectionToolbarPanel()
  /// Nil until the page first pushes the setting.
  private var settings: SelectionToolbarSettings?
  private var monitor: Any?
  /// Keys, scrolls and other buttons, watched only while a check is pending or the toolbar
  /// shows: each makes a check stale or hides the toolbar.
  private var interruptMonitor: Any?
  /// Pointer moves, watched only while the toolbar shows.
  private var moveMonitor: Any?
  private var activationObserver: NSObjectProtocol?
  private var pressedAt: CGPoint?
  /// Bumped by every press, key, scroll and app switch, so a check that started before one is
  /// dropped.
  private var generation = 0
  private var pending: Task<Void, Never>?
  /// The guide's practice selection while the toolbar shows for it.
  private var practiceText: String?
  /// Pointer moves over this app's own windows, watched while the practice toolbar shows: the
  /// global monitors see only other apps, and hover tracking needs a move to resume.
  private var practiceMoveMonitor: Any?

  init(trust: AccessibilityTrust) {
    self.trust = trust
    panel.onAsk = { [weak self] in
      let text = self?.practiceText
      self?.dismiss()
      self?.onAsk?(text)
    }
    panel.onCommand = { [weak self] id in
      let practice = self?.practiceText != nil
      self?.dismiss()
      if !practice { self?.onCommand?(id) }
    }
  }

  /// The page's `toolbar.set`.
  func apply(_ settings: SelectionToolbarSettings) {
    self.settings = settings
    panel.setCommands(settings.commands)
    update()
  }

  /// Installs the monitors exactly while the toolbar is on and trusted.
  func update() {
    let active = settings?.enabled == true && trust.isTrusted
    if active, monitor == nil {
      install()
    } else if !active, monitor != nil {
      uninstall()
    }
  }

  // MARK: Practice

  /// Shows the toolbar beside the guide's practice selection (`selection` in Cocoa global
  /// points) when the real one would show at all: the setting is on and the app is trusted.
  /// Otherwise any practice toolbar hides.
  func showPractice(selection: CGRect, text: String) {
    guard settings?.enabled == true, trust.isTrusted else { return hidePractice() }
    dismiss()
    practiceText = text
    let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
    // The panel takes Quartz bounds, as Accessibility reports them.
    panel.show(
      selection: CaptureCoordinates.flip(selection, primaryHeight: primaryHeight),
      pointer: CGPoint(x: selection.midX, y: selection.midY))
    practiceMoveMonitor = NSEvent.addLocalMonitorForEvents(
      matching: [.mouseMoved, .leftMouseDragged]
    ) { [weak self] event in
      MainActor.assumeIsolated { self?.panel.pointerMoved() }
      return event
    }
  }

  /// Hides a practice toolbar; a toolbar over another app's selection stays.
  func hidePractice() {
    if practiceText != nil { dismiss() }
  }

  // MARK: Monitoring

  private func install() {
    monitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp]) {
      [weak self] event in
      MainActor.assumeIsolated { self?.handle(event) }
    }
    activationObserver = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
    ) { [weak self] _ in MainActor.assumeIsolated { self?.dismiss() } }
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
    let pointer = NSEvent.mouseLocation
    switch event.type {
    case .leftMouseDown:
      dismiss()
      pressedAt = pointer
    case .leftMouseUp:
      let selected = SelectionGesture.mayHaveSelected(
        down: pressedAt, up: pointer, clickCount: event.clickCount,
        shift: event.modifierFlags.contains(.shift))
      pressedAt = nil
      if selected { schedule(at: pointer, immediately: event.clickCount < 2) }
    default:
      dismiss()
    }
  }

  private func schedule(at pointer: CGPoint, immediately: Bool) {
    pending?.cancel()
    watchInterruptions()
    let token = generation
    pending = Task { [weak self] in
      if immediately, await self?.check(pointer: pointer, token: token) == true { return }
      try? await Task.sleep(for: Self.debounce)
      guard !Task.isCancelled else { return }
      let shown = await self?.check(pointer: pointer, token: token) == true
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
  private func check(pointer: CGPoint, token: Int) async -> Bool {
    guard token == generation, let settings,
      let app = NSWorkspace.shared.frontmostApplication
    else { return false }
    let context = SelectionToolbarContext(
      enabled: settings.enabled, trusted: trust.isTrusted,
      frontmostBundleId: app.bundleIdentifier, ownBundleId: Bundle.main.bundleIdentifier,
      excludedBundleIds: settings.excludedBundleIds, secureInput: IsSecureEventInputEnabled())
    guard SelectionToolbarRules.shouldProbe(context) else { return false }
    let probe = await SelectionPresence.check(pid: app.processIdentifier)
    guard token == generation, monitor != nil,
      NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier,
      SelectionToolbarRules.shows(probe)
    else { return false }
    var bounds: CGRect?
    if case .selected(_, let rect) = probe { bounds = rect }
    panel.show(selection: bounds, pointer: pointer)
    watchPointer()
    return true
  }

  // MARK: Dismissal

  private func watchPointer() {
    guard moveMonitor == nil else { return }
    moveMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) {
      [weak self] _ in
      MainActor.assumeIsolated {
        guard let self else { return }
        self.panel.pointerMoved()
        let pointer = NSEvent.mouseLocation
        if SelectionToolbarRules.pointerLeft(self.panel.frame, x: pointer.x, y: pointer.y) {
          self.dismiss()
        }
      }
    }
  }

  /// Hides the toolbar and drops any check still running.
  private func dismiss() {
    generation += 1
    pending?.cancel()
    pending = nil
    if let moveMonitor { NSEvent.removeMonitor(moveMonitor) }
    moveMonitor = nil
    if let practiceMoveMonitor { NSEvent.removeMonitor(practiceMoveMonitor) }
    practiceMoveMonitor = nil
    practiceText = nil
    stopWatchingInterruptions()
    panel.hide()
  }
}
