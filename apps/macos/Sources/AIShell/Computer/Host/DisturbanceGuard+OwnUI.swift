import AIChromeChannelKit
import AppKit
import Foundation

/// Distinguishes hardware input that landed on Atd's own UI from input aimed at a target app
/// (plan §1 F9/F10, D10). Clicking or typing on Atd for Chrome's in-page HUD (`Allow once`,
/// `Hand back`, `Ask`) or one of Atd's own non-activating panels (`NSApp`) updates macOS's global
/// HID event timestamps while the target app stays frontmost. Local `NSApp` events record their
/// exact WindowServer `NSEvent.timestamp`; Chrome HUD frames carry source-stamped `OwnInput`
/// timestamps that must match live HID readings and apply only to that Chrome's `browserPid`. Any
/// subsequent click, scroll or key press into the target — including into a secure field, subframe
/// or browser chrome — produces an unmatched timestamp or event type and yields `.targetInUse`.
extension DisturbanceGuard {
  enum OwnUIScope: Equatable {
    case anyTarget
    case process(pid_t)

    func matches(targetPid: pid_t?) -> Bool {
      switch self {
      case .anyTarget: true
      case .process(let pid): targetPid == pid
      }
    }
  }

  struct OwnUIEvent: Equatable {
    let uptime: TimeInterval
    let scope: OwnUIScope
  }

  static let targetInputTypes: [CGEventType] = [
    .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel,
  ]

  /// Sampling-jitter tolerance when matching two `systemUptime` readings of the same HID event.
  static let ownUIEventTolerance: TimeInterval = 0.008
  /// Clock-bridge tolerance when verifying a Chrome content-script HUD timestamp against live HID.
  static let chromeClockTolerance: TimeInterval = 0.025
  private static let maxOwnUIEventsPerType = 8

  /// Installs the lightweight local monitor for Atd's own windows/panels while the computer host
  /// runs, so clicks, scrolls or keys delivered to `NSApp` non-activating surfaces are recorded
  /// with their exact `NSEvent.timestamp` even when no write step is currently watched.
  func startOwnUIMonitor() {
    guard ownUIMonitor == nil else { return }
    let events: NSEvent.EventTypeMask = [
      .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel,
    ]
    ownUIMonitor = NSEvent.addLocalMonitorForEvents(matching: events) { [weak self] event in
      self?.receivedOwnUILocalEvent(event)
      return event
    }
  }

  func stopOwnUIMonitor() {
    guard let monitor = ownUIMonitor else { return }
    NSEvent.removeMonitor(monitor)
    ownUIMonitor = nil
  }

  /// Verifies source-stamped HUD timestamps from Atd for Chrome against live HID state and scopes
  /// matched events strictly to `browserPid`. Events outside the 3s active-use window or superseded
  /// by newer target input fail verification and remain unattributed.
  func noteChromeOwnInput(_ input: ChromeOwnInput?, browserPid: pid_t) {
    guard let input, browserPid > 0 else { return }
    let nowWall = Date().timeIntervalSince1970
    let nowUptime = ProcessInfo.processInfo.systemUptime
    let candidates: [(CGEventType, Double?)] = [
      (.keyDown, input.keyDown),
      (.leftMouseDown, input.leftMouseDown),
      (.rightMouseDown, input.rightMouseDown),
      (.otherMouseDown, input.otherMouseDown),
      (.scrollWheel, input.scrollWheel),
    ]
    for (cgType, wallMs) in candidates {
      guard let wallMs else { continue }
      let age = nowWall - wallMs / 1000
      guard age.isFinite, age >= -0.025, age <= 3.0 else { continue }
      let expectedUptime = nowUptime - max(0, age)
      guard let live = Self.sampleHardwareAge(cgType),
        abs(live.uptime - expectedUptime) <= Self.chromeClockTolerance
      else { continue }
      recordOwnUIHardwareEvent(
        cgType, event: OwnUIEvent(uptime: live.uptime, scope: .process(browserPid)))
    }
  }

  /// When the person last pressed a key, clicked or scrolled outside Atd's own UI, within the
  /// last hour. Used by ``ComputerCoordinator/interruption(_:engine:)`` so Atd's own approval and
  /// panel controls do not self-trigger `targetInUse`, while every input into a target still does.
  func lastTargetInput(forTargetPid targetPid: pid_t? = nil) -> ContinuousClock.Instant? {
    let now = ContinuousClock.now
    var latest: ContinuousClock.Instant?
    for type in Self.targetInputTypes {
      if let sample = Self.sampleHardwareAge(type),
        !isOwnUIHardwareEvent(type, uptime: sample.uptime, targetPid: targetPid)
      {
        let instant = now - .seconds(sample.age)
        latest = latest.map { max($0, instant) } ?? instant
      }
      if let seen = lastSeenExternalByType[type], now - seen.at < .seconds(3600),
        !isOwnUIHardwareEvent(type, uptime: seen.uptime, targetPid: targetPid)
      {
        latest = latest.map { max($0, seen.at) } ?? seen.at
      }
    }
    if let other = lastSeenExternalOther, now - other < .seconds(3600) {
      latest = latest.map { max($0, other) } ?? other
    }
    return latest
  }

  func recordOwnUILocalEvent(
    type: NSEvent.EventType, timestamp: TimeInterval, hasCGEvent: Bool
  ) {
    guard hasCGEvent, let cgType = Self.targetInputType(of: type), timestamp > 0 else { return }
    let nowUptime = ProcessInfo.processInfo.systemUptime
    guard timestamp <= nowUptime + 0.005, nowUptime - timestamp <= 60 else { return }
    recordOwnUIHardwareEvent(cgType, event: OwnUIEvent(uptime: timestamp, scope: .anyTarget))
  }

  func recordOwnUIHardwareEvent(_ type: CGEventType, event: OwnUIEvent) {
    let cutoff = ProcessInfo.processInfo.systemUptime - 60
    for key in Array(ownUIHardwareEvents.keys) {
      let kept = (ownUIHardwareEvents[key] ?? []).filter { $0.uptime >= cutoff }
      ownUIHardwareEvents[key] = kept.isEmpty ? nil : kept
    }
    var list = ownUIHardwareEvents[type] ?? []
    if list.contains(where: {
      $0.scope == event.scope && abs($0.uptime - event.uptime) <= Self.ownUIEventTolerance
    }) {
      return
    }
    list.append(event)
    if list.count > Self.maxOwnUIEventsPerType {
      list.removeFirst(list.count - Self.maxOwnUIEventsPerType)
    }
    ownUIHardwareEvents[type] = list
  }

  func isOwnUIHardwareEvent(_ type: CGEventType, uptime: TimeInterval, targetPid: pid_t?) -> Bool {
    guard let list = ownUIHardwareEvents[type] else { return false }
    return list.contains {
      $0.scope.matches(targetPid: targetPid) && abs(uptime - $0.uptime) <= Self.ownUIEventTolerance
    }
  }

  private nonisolated func receivedOwnUILocalEvent(_ event: NSEvent) {
    let hasCGEvent = event.cgEvent != nil
    let source = event.cgEvent?.getIntegerValueField(.eventSourceUnixProcessID) ?? 0
    let synthesized = KeyPress.isSynthesized(event)
    let type = event.type
    let timestamp = event.timestamp
    MainActor.assumeIsolated {
      guard !synthesized, !isEngine(source) else { return }
      recordOwnUILocalEvent(type: type, timestamp: timestamp, hasCGEvent: hasCGEvent)
    }
  }

  /// Maps an `NSEvent.EventType` to its corresponding HID `CGEventType` in ``targetInputTypes``.
  nonisolated static func targetInputType(of type: NSEvent.EventType) -> CGEventType? {
    switch type {
    case .keyDown: .keyDown
    case .leftMouseDown: .leftMouseDown
    case .rightMouseDown: .rightMouseDown
    case .otherMouseDown: .otherMouseDown
    case .scrollWheel: .scrollWheel
    default: nil
    }
  }

  /// Discrete multi-touch gestures without a `targetInputTypes` `CGEventType`. Ancillary events
  /// that accompany clicks, scrolls or modifiers (`.pressure`, `.beginGesture`, `.gesture`,
  /// `.endGesture`, `.flagsChanged`, `.systemDefined`) are excluded so own-UI clicks/scrolls/keys
  /// under a concurrent ``Watch`` do not leave an unscoped `targetInUse` timestamp behind.
  nonisolated static func isStandaloneExternalGesture(_ type: NSEvent.EventType) -> Bool {
    switch type {
    case .magnify, .swipe, .rotate, .smartMagnify: true
    default: false
    }
  }

  /// Samples the HID age (`secondsSinceLastEventType`) and derives the event's `systemUptime`
  /// timestamp, retrying once if thread preemption stretched the read bracket past 5 ms.
  static func sampleHardwareAge(_ type: CGEventType) -> (age: TimeInterval, uptime: TimeInterval)? {
    for _ in 0..<2 {
      let before = ProcessInfo.processInfo.systemUptime
      let seconds = CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: type)
      let after = ProcessInfo.processInfo.systemUptime
      guard seconds.isFinite, seconds >= 0, seconds < 3600 else { return nil }
      if after - before <= 0.005 { return (seconds, (before + after) * 0.5 - seconds) }
    }
    let before = ProcessInfo.processInfo.systemUptime
    let seconds = CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: type)
    guard seconds.isFinite, seconds >= 0, seconds < 3600 else { return nil }
    return (seconds, before - seconds)
  }
}
