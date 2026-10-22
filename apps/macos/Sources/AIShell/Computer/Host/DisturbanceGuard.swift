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
/// Nothing is masked by time, so the person's real input during a step always counts. The HID
/// system's event state is theirs alone: the engines post their input, the foreground fallback's
/// included, from a private source to the target's process, never through the HID system (R13).
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
  /// The person's latest input of any kind the monitors saw, pointer movement included.
  private var lastSeenActivity: ContinuousClock.Instant?
  /// The person's latest key press (not a modifier or system key on its own) the monitors saw.
  private var lastSeenKeyDown: ContinuousClock.Instant?
  /// `kCGAnyInputEventType`: an event of any input type, for the HID system's event state.
  private static let anyInput = CGEventType(rawValue: ~0)
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

  /// What the person had in front when `watch`'s current step began; nil outside a step.
  func before(_ watch: Watch) -> DisturbanceSnapshot? { watch.step?.before }

  /// Whether the person used any input at or after `start`: one the monitors saw (keys, modifier
  /// and system keys, clicks, scrolls, pointer movement, trackpad gestures), or any event the HID
  /// system took from the hardware since, which also covers what a monitor never sees, such as a
  /// shortcut the system consumes. What stops a foreground step at once (R5).
  func personActed(since start: ContinuousClock.Instant) -> Bool {
    lastPersonActivity().map { $0 >= start } ?? false
  }

  /// Whether the person pressed a key at or after `start`, by the monitors or the HID system:
  /// typing that reached whatever app was in front then.
  func personTyped(since start: ContinuousClock.Instant) -> Bool {
    [lastSeenKeyDown, Self.hardwareEvent(.keyDown, now: .now)].contains {
      $0.map { $0 >= start } ?? false
    }
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
        repaired: $0.repaired, foreground: $0.foreground)
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
    if found.contains(where: { $0.kind == .raise && $0.attribution == .agent }),
      let metadata = DisturbanceSnapshot.raiseMetadata(
        before: step.before, after: after, reading: reading)
    {
      Self.log.notice("Raise detection metadata: \(metadata, privacy: .public)")
    }
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
    let now = ContinuousClock.now
    let hardware = types.compactMap { Self.hardwareEvent($0, now: now) }.max()
    switch (hardware, lastSeenInput) {
    case (let hardware?, let seen?): return max(hardware, seen)
    case (let hardware?, nil): return hardware
    case (nil, let seen): return seen.flatMap { .now - $0 < .seconds(3600) ? $0 : nil }
    }
  }

  /// When the person last used any input, by the HID system's event state for every input type
  /// or the monitors' latest sighting, whichever is later: what a foreground step waits to have
  /// been quiet for before it brings the target forward (R4.1). Nil when there was none in the
  /// last hour.
  func lastPersonActivity() -> ContinuousClock.Instant? {
    let hardware = Self.anyInput.flatMap { Self.hardwareEvent($0, now: .now) }
    return [hardware, lastSeenActivity].compactMap { $0 }.max()
  }

  // MARK: Monitors

  private func startMonitors() {
    let events: NSEvent.EventTypeMask = [
      .keyDown, .flagsChanged, .systemDefined, .leftMouseDown, .rightMouseDown, .otherMouseDown,
      .scrollWheel, .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
      .gesture, .magnify, .swipe, .rotate, .smartMagnify, .beginGesture, .endGesture, .pressure,
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
    let keyDown = event.type == .keyDown
    MainActor.assumeIsolated {
      guard !synthesized, !isEngine(source) else { return }
      if input != .motion { lastSeenInput = .now }
      if keyDown { lastSeenKeyDown = .now }
      lastSeenActivity = .now
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
    case .keyDown, .flagsChanged, .systemDefined: .keys
    case .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged: .motion
    // Buttons, scrolling and trackpad gestures.
    default: .clicks
    }
  }

  /// The person's hardware input since `start`, from the event state of the HID system, which
  /// the engines' private-source events never update; it also covers what a monitor cannot see,
  /// such as typing into a secure field.
  private static func hardwareInput(since start: ContinuousClock.Instant)
    -> DisturbanceReading.PersonInput
  {
    let now = ContinuousClock.now
    let seen = { (types: [CGEventType]) in
      types.contains { hardwareEvent($0, now: now).map { $0 > start } ?? false }
    }
    var input: DisturbanceReading.PersonInput = []
    if seen([.keyDown, .flagsChanged]) { input.insert(.keys) }
    if seen([.leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel]) {
      input.insert(.clicks)
    }
    if seen([.mouseMoved, .leftMouseDragged, .rightMouseDragged]) { input.insert(.motion) }
    return input
  }

  /// When the HID system last saw an event of `type` from the hardware, within the last hour.
  private static func hardwareEvent(_ type: CGEventType, now: ContinuousClock.Instant)
    -> ContinuousClock.Instant?
  {
    let seconds = CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: type)
    guard seconds.isFinite, seconds >= 0, seconds < 3600 else { return nil }
    return now - .seconds(seconds)
  }
}
