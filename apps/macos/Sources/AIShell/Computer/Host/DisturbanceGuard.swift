import AICore
import AppKit
import OSLog

/// The disturbance guard (plan §4.3, I6, I8). A write action is watched from its first step to
/// its end (``watch(target:)``, ``stop(_:)``); around each write step (``begin(_:)``,
/// ``end(_:receipt:)``) it reads what the person would notice changing, from host-side signals
/// only: app activations and the frontmost app, the active Space, the on-screen window order, the
/// pointer, the general pasteboard and the person's own hardware input. It never makes
/// accessibility calls into other apps; agent-side facts come from the engine's receipt, which
/// ``DisturbanceRules`` merges with these readings. The monitors run only while an action is
/// watched.
///
/// The person's input is told from the engines' by process identity and Atd's marker: an event
/// Atd synthesized (``KeyPress/isSynthesized(_:)``) or one whose source process
/// (`kCGEventSourceUnixProcessID`) posts an engine's input (``engineProcesses``) is never theirs.
/// Nothing is masked by time, so the person's real input during a step always counts.
final class DisturbanceGuard {
  /// One write action under watch, and the step it is in.
  final class Watch {
    fileprivate let target: Set<pid_t>
    /// The targets of other actions watched at the same time, which their own readings cover.
    fileprivate var others: Set<pid_t> = []
    fileprivate var step: Step?

    fileprivate init(target: Set<pid_t>) { self.target = target }
  }

  /// What one step saw so far.
  fileprivate struct Step {
    let started: ContinuousClock.Instant
    let before: DisturbanceSnapshot
    var input: DisturbanceReading.PersonInput = []
    var activated: [pid_t] = []
    var spaceChanged = false
  }

  /// The processes whose events are the engines' own.
  var engineProcesses: () -> Set<pid_t> = { [] }

  private var watches: [Watch] = []
  private var monitors: [Any] = []
  private var observers: [any NSObjectProtocol] = []
  /// The person's latest key press, click or scroll the monitors saw.
  private var lastSeenInput: ContinuousClock.Instant?
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "computer-input")

  /// Watches a write action on `target`'s processes until ``stop(_:)``.
  func watch(target: Set<pid_t>) -> Watch {
    let watch = Watch(target: target)
    for other in watches {
      other.others.formUnion(target)
      watch.others.formUnion(other.target)
    }
    watches.append(watch)
    if watches.count == 1 { startMonitors() }
    return watch
  }

  func stop(_ watch: Watch) {
    watches.removeAll { $0 === watch }
    if watches.isEmpty { stopMonitors() }
  }

  /// A write step of `watch` starts.
  func begin(_ watch: Watch) {
    watch.step = Step(
      started: .now, before: DisturbanceSnapshot.read(target: watch.target))
  }

  /// The step ended: what changed for the person while it ran, attributed with the engine's
  /// `receipt` (nil when it sent no input or keeps no receipts).
  func end(_ watch: Watch, receipt: EngineInputReceipt?) -> [ComputerDisturbanceWire] {
    guard let step = watch.step else { return [] }
    watch.step = nil
    let after = DisturbanceSnapshot.read(
      target: watch.target, personWindow: step.before.personWindow)
    var reading = DisturbanceReading()
    reading.receipt = receipt.map {
      DisturbanceReading.Receipt(
        keyScopeUsed: $0.keyScopeUsed, keyScopeReturned: $0.keyScopeReturned,
        personWindowRestored: $0.personWindowRestored, frontmostChanged: $0.frontmostChanged,
        repaired: $0.repaired)
    }
    reading.personInput = step.input.union(Self.hardwareInput(since: step.started))
    reading.target = watch.target
    reading.ignored = watch.others.union([ProcessInfo.processInfo.processIdentifier])
    reading.frontmostBefore = step.before.frontmost
    reading.frontmostAfter = after.frontmost
    reading.activated = step.activated
    reading.spaceChanged = step.spaceChanged
    reading.targetAboveBefore = step.before.targetAbove
    reading.targetAboveAfter = after.targetAbove
    reading.pointerMoved = step.before.pointerMoved(by: after)
    reading.pasteboardChanged = after.pasteboard != step.before.pasteboard
    if after.frontmost == step.before.frontmost {
      reading.personWindowsBefore = step.before.personWindows
      reading.personWindowsAfter = after.personWindows
    }
    let found = DisturbanceRules.disturbances(in: reading)
    for disturbance in found {
      Self.log.notice(
        "Disturbance: kind=\(disturbance.kind.rawValue, privacy: .public) attribution=\(disturbance.attribution.rawValue, privacy: .public) repaired=\(disturbance.repaired)"
      )
    }
    return found
  }

  /// When the person last pressed a key, clicked or scrolled, in any app: the hardware event
  /// state, which events posted from a private source never touch, or the monitors' latest
  /// sighting when later. Nil when there was none in the last hour.
  func lastPersonInput() -> ContinuousClock.Instant? {
    let types: [CGEventType] = [
      .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel,
    ]
    let seconds = types.map {
      CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: $0)
    }.min()
    let hardware = seconds.flatMap { value -> ContinuousClock.Instant? in
      guard value.isFinite, value >= 0, value < 3600 else { return nil }
      return ContinuousClock.now - .seconds(value)
    }
    switch (hardware, lastSeenInput) {
    case (let hardware?, let seen?): return max(hardware, seen)
    case (let hardware?, nil): return hardware
    case (nil, let seen): return seen.flatMap { .now - $0 < .seconds(3600) ? $0 : nil }
    }
  }

  // MARK: Monitors

  private func startMonitors() {
    let events: NSEvent.EventTypeMask = [
      .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel, .mouseMoved,
      .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
    ]
    if let global = NSEvent.addGlobalMonitorForEvents(
      matching: events, handler: { [weak self] event in self?.received(event) })
    {
      monitors.append(global)
    }
    if let local = NSEvent.addLocalMonitorForEvents(
      matching: events,
      handler: { [weak self] event in
        self?.received(event)
        return event
      })
    {
      monitors.append(local)
    }
    let center = NSWorkspace.shared.notificationCenter
    observers.append(
      center.addObserver(
        forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
      ) { [weak self] note in
        let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
        let pid = app?.processIdentifier
        MainActor.assumeIsolated {
          // A notification can arrive after the switch it reports was undone; only an app that
          // is still frontmost counts (the engine's receipt reports flips it made itself).
          guard let self, let pid,
            NSWorkspace.shared.frontmostApplication?.processIdentifier == pid
          else { return }
          for watch in self.watches { watch.step?.activated.append(pid) }
        }
      })
    observers.append(
      center.addObserver(
        forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          for watch in self?.watches ?? [] { watch.step?.spaceChanged = true }
        }
      })
  }

  private func stopMonitors() {
    for monitor in monitors { NSEvent.removeMonitor(monitor) }
    monitors = []
    let center = NSWorkspace.shared.notificationCenter
    for observer in observers { center.removeObserver(observer) }
    observers = []
  }

  private nonisolated func received(_ event: NSEvent) {
    let source = event.cgEvent?.getIntegerValueField(.eventSourceUnixProcessID) ?? 0
    let synthesized = KeyPress.isSynthesized(event)
    let input = Self.input(of: event.type)
    MainActor.assumeIsolated {
      guard !synthesized, !isEngine(source) else { return }
      if input != .motion { lastSeenInput = .now }
      for watch in watches { watch.step?.input.insert(input) }
    }
  }

  private func isEngine(_ source: Int64) -> Bool {
    source > 0 && engineProcesses().contains(pid_t(clamping: source))
  }

  private nonisolated static func input(of type: NSEvent.EventType)
    -> DisturbanceReading.PersonInput
  {
    switch type {
    case .keyDown: .keys
    case .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged: .motion
    default: .clicks
    }
  }

  /// The person's hardware input since `start`, from the event state of the HID system, which
  /// the engines' private-source events never update; it also covers what a monitor cannot see,
  /// such as typing into a secure field.
  private static func hardwareInput(since start: ContinuousClock.Instant)
    -> DisturbanceReading.PersonInput
  {
    let elapsed = ContinuousClock.now - start
    let window =
      Double(elapsed.components.seconds) + Double(elapsed.components.attoseconds) / 1e18
    let seen = { (types: [CGEventType]) in
      types.contains {
        CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: $0) < window
      }
    }
    var input: DisturbanceReading.PersonInput = []
    if seen([.keyDown]) { input.insert(.keys) }
    if seen([.leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel]) {
      input.insert(.clicks)
    }
    if seen([.mouseMoved, .leftMouseDragged, .rightMouseDragged]) { input.insert(.motion) }
    return input
  }
}
