import AICore
import AppKit
import Carbon.HIToolbox

/// What the user does while a take records (decision R11): clicks inside the recorded region
/// with the Accessibility role and title of what was clicked, key presses, and app and window
/// switches, each stamped on the host clock (``RecordingSamples/hostNow``) for the take to place
/// at media time.
///
/// Global monitors see other apps' events only, so presses on Atd's own controls (the Island,
/// the status item) are never steps. Keys are skipped while secure input is on (a password field
/// has focus), and macOS delivers global key events only with the Accessibility grant: without
/// it the log holds clicks and switches alone. Characters typed through an input method are
/// logged as the keys pressed, before composition.
final class RecordingInputLog {
  /// Told each key press the log records, for the key badges.
  var onKey: ((RecordingKeyPress) -> Void)?

  /// The recorded region, Quartz points.
  private let region: CGRect
  private var events: [RecordingInputEvent] = []
  private var monitors: [Any] = []
  private var activation: NSObjectProtocol?
  private let reader = RecordingElementReader()
  private let windowReader = RecordingWindowReader()
  /// Only outstanding window and Accessibility lookups; finished tasks do not accumulate.
  private var lookups: [Int: Task<Void, Never>] = [:]
  private var nextLookup = 0
  /// Window results may finish out of order; their slots retain the input order.
  private var windows: [WindowObservation?] = []
  private var initialFront: (pid: pid_t, window: String?)?

  init(region: CGRect) {
    self.region = region
  }

  func start() {
    guard monitors.isEmpty else { return }
    initialFront = NSWorkspace.shared.frontmostApplication.map { ($0.processIdentifier, nil) }
    let clicks = NSEvent.addGlobalMonitorForEvents(
      matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]
    ) { [weak self] event in
      MainActor.assumeIsolated { self?.clicked(event) }
    }
    let keys = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
      MainActor.assumeIsolated { self?.pressed(event) }
    }
    monitors = [clicks, keys].compactMap(\.self)
    activation = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
    ) { [weak self] note in
      // `Notification` is not Sendable, so only the pid crosses into the main-actor handler.
      let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
      let pid = app?.processIdentifier
      MainActor.assumeIsolated { self?.activated(pid) }
    }
  }

  /// Stops hearing new events; those heard stay for ``stop()``.
  func stopListening() {
    for monitor in monitors { NSEvent.removeMonitor(monitor) }
    monitors = []
    if let activation { NSWorkspace.shared.notificationCenter.removeObserver(activation) }
    activation = nil
  }

  /// Stops listening and answers the events in order once window and Accessibility lookups
  /// have finished. A window switch is resolved in input order, not lookup-completion order.
  func stop() async -> [RecordingInputEvent] {
    stopListening()
    let pending = Array(lookups.values)
    for lookup in pending { await lookup.value }
    return (events + windowSwitches()).sorted { $0.time < $1.time }
  }

  private func clicked(_ event: NSEvent) {
    guard let cgEvent = event.cgEvent, region.contains(cgEvent.location) else { return }
    let point = cgEvent.location
    let rawWindow = cgEvent.getIntegerValueField(
      .mouseEventWindowUnderMousePointerThatCanHandleThisEvent)
    let windowID = UInt32(exactly: rawWindow).flatMap { $0 == 0 ? nil : $0 }
    let button: RecordingClick.Button =
      switch event.type {
      case .leftMouseDown: .left
      case .rightMouseDown: .right
      default: .other
      }
    let location = CGPoint(
      x: (point.x - region.minX) / max(region.width, 1),
      y: (point.y - region.minY) / max(region.height, 1))
    let click = RecordingClick(button: button, count: max(1, event.clickCount), location: location)
    let index = events.count
    events.append(RecordingInputEvent(time: event.timestamp, kind: .click(click)))
    let windowIndex = windows.count
    windows.append(nil)
    let time = event.timestamp
    track { [weak self, reader, windowReader] in
      let snapshot = await windowReader.take()
      // The event's window number survives focus and z-order changes while the background
      // snapshot is in flight. Do not attribute a closed window's click to a different one.
      let hit =
        if let windowID {
          snapshot.entries.first { $0.window.windowID == windowID }
        } else {
          snapshot.entries.first { $0.window.quartzFrame.contains(point) }
        }
      guard let self else { return }
      guard let hit else { return }
      let pid = hit.window.pid
      self.windows[windowIndex] = .click(pid: pid, title: hit.title, time: time)
      let element = await reader.element(at: point, pid: pid)
      guard let element, index < self.events.count,
        case .click(var described) = self.events[index].kind
      else { return }
      described.role = element.role
      described.title = element.title
      self.events[index].kind = .click(described)
    }
  }

  private func pressed(_ event: NSEvent) {
    guard !event.isARepeat, !IsSecureEventInputEnabled(), !KeyPress.isSynthesized(event),
      let press = RecordingKeyPress(event)
    else { return }
    events.append(RecordingInputEvent(time: event.timestamp, kind: press.kind))
    onKey?(press)
  }

  private func activated(_ pid: pid_t?) {
    guard let pid, pid != ProcessInfo.processInfo.processIdentifier,
      let app = NSRunningApplication(processIdentifier: pid)
    else { return }
    let windowIndex = windows.count
    windows.append(nil)
    events.append(
      RecordingInputEvent(
        time: RecordingSamples.hostNow,
        kind: .appSwitch(
          name: app.localizedName ?? app.bundleIdentifier ?? "", bundleID: app.bundleIdentifier)))
    track { [weak self, windowReader] in
      let snapshot = await windowReader.take()
      let title = snapshot.entries.first { $0.window.pid == pid && $0.window.layer == 0 }?.title
      self?.windows[windowIndex] = .activation(pid: pid, title: title)
    }
  }

  private func track(_ operation: @escaping @MainActor () async -> Void) {
    let id = nextLookup
    nextLookup += 1
    lookups[id] = Task { [weak self] in
      await operation()
      self?.lookups[id] = nil
    }
  }

  /// A click on another window of the app in front is a window switch. Reconcile the captured
  /// observations only after all reads complete, since a later fast read may finish first.
  private func windowSwitches() -> [RecordingInputEvent] {
    var front = initialFront
    var switches: [RecordingInputEvent] = []
    for case let observation? in windows {
      switch observation {
      case .activation(let pid, let title):
        front = (pid, title)
      case .click(let pid, let title, let time):
        if let prior = front, prior.pid == pid, let title, !title.isEmpty,
          let previous = prior.window, previous != title
        {
          switches.append(RecordingInputEvent(time: time, kind: .windowSwitch(title: title)))
        }
        front = (pid, title ?? front?.window)
      }
    }
    return switches
  }
}

private enum WindowObservation {
  case activation(pid: pid_t, title: String?)
  case click(pid: pid_t, title: String?, time: Double)
}

/// WindowServer queries can block for hundreds of milliseconds. Limit concurrent snapshots
/// without keeping the main actor or the Accessibility reader waiting for them.
nonisolated private final class RecordingWindowReader: Sendable {
  private let queue: OperationQueue

  init() {
    let queue = OperationQueue()
    queue.name = "com.junerdd.ai.recording-windows"
    queue.qualityOfService = .userInitiated
    queue.maxConcurrentOperationCount = 2
    self.queue = queue
  }

  func take() async -> WindowSnapshot {
    await withCheckedContinuation { continuation in
      queue.addOperation {
        continuation.resume(returning: WindowSnapshot.take())
      }
    }
  }
}

/// The Accessibility side of the input log, on its own queue: a call blocks on the target app,
/// and a hung app must not hold the main actor. `AXUIElement` never leaves the actor.
private actor RecordingElementReader {
  private let queue = DispatchSerialQueue(label: "com.junerdd.ai.recording-ax", qos: .utility)
  nonisolated var unownedExecutor: UnownedSerialExecutor { queue.asUnownedSerialExecutor() }

  /// The role and title of what app `pid` shows at `point` (Quartz); nil without the
  /// Accessibility grant or an answer. Each call waits at most the probe's messaging timeout.
  func element(at point: CGPoint, pid: pid_t) -> (role: String, title: String?)? {
    guard AXIsProcessTrusted(),
      let element = AccessibilityProbe.element(
        at: point, in: AccessibilityProbe.application(pid: pid))
    else { return nil }
    AXUIElementSetMessagingTimeout(element, AccessibilityProbe.messagingTimeout)
    guard let description = AccessibilityProbe.description(of: element) else { return nil }
    return (description.role, description.title)
  }
}
