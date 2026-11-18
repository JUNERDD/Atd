import AICore
import AppKit
import Carbon.HIToolbox
import OSLog

/// UU can reintroduce a released Command flag on the next modifier's release. Correct only
/// that observed event at the HID boundary, before its flags enter the system state again.
/// This never posts keys or clears an existing state without its complete release sequence.
///
/// Ordinary non-UU typing events incur `0 ns` ring-write overhead (`01` §3.2); only state
/// transitions (`tapCreate` failure, `.tapDisabledByTimeout` / `.tapDisabledByUserInput`, rising
/// edge of `IsSecureEventInputEnabled()`, and stripped stale `.maskCommand`) append a fixed 96-byte
/// `HotKeyDecisionEntry` (`< 150 ns`, zero heap allocation).
final class RemoteModifierRepair {
  var decisionRing: HotKeyDecisionRing?
  private(set) var tapDisabledCount: UInt16 = 0
  private(set) var tapInstallFailed = false
  private var wasSecureInput = false
  private var tap: CFMachPort?
  private var source: CFRunLoopSource?
  private var sequence = RemoteModifierSequence()
  private var registered: Set<HotKeyCombination> = []
  private var trusted = false
  private var identity: (pid: pid_t, start: UInt64, matches: Bool)?
  private var observers: [NSObjectProtocol] = []
  private var secureCheck: Timer?
  private static let modifiers: CGEventFlags = [
    .maskCommand, .maskShift, .maskAlternate, .maskControl,
  ]
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "hotkeys")

  init() {
    let center = NSWorkspace.shared.notificationCenter
    for name in [
      NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification,
    ] {
      observers.append(
        center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          MainActor.assumeIsolated {
            guard let self else { return }
            self.watch(self.registered, trusted: self.trusted)
          }
        })
    }
    for name in [NSWorkspace.willSleepNotification, NSWorkspace.sessionDidResignActiveNotification]
    {
      observers.append(
        center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          MainActor.assumeIsolated { self?.sequence.reset() }
        })
    }
  }

  func watch(_ registered: Set<HotKeyCombination>, trusted: Bool) {
    self.trusted = trusted
    if self.registered != registered {
      self.registered = registered
      sequence.reset(keyboardIsClear: Self.keyboardIsClear)
    }
    guard trusted, !registered.isEmpty, CGPreflightPostEventAccess(),
      !NSRunningApplication.runningApplications(withBundleIdentifier: "com.netease.uuremote")
        .isEmpty
    else {
      tapInstallFailed = false
      stop()
      return
    }
    if let tap, !CGEvent.tapIsEnabled(tap: tap) { stop() }
    guard tap == nil else { return }
    let mask = [CGEventType.keyDown, .keyUp, .flagsChanged]
      .reduce(CGEventMask(0)) { $0 | CGEventMask(1) << $1.rawValue }
    guard
      let tap = CGEvent.tapCreate(
        tap: .cghidEventTap, place: .headInsertEventTap, options: .defaultTap,
        eventsOfInterest: mask,
        callback: { _, type, event, context in
          guard let context else { return Unmanaged.passUnretained(event) }
          MainActor.assumeIsolated {
            Unmanaged<RemoteModifierRepair>.fromOpaque(context).takeUnretainedValue()
              .receive(type, event: event)
          }
          return Unmanaged.passUnretained(event)
        }, userInfo: Unmanaged.passUnretained(self).toOpaque()),
      let source = CFMachPortCreateRunLoopSource(nil, tap, 0)
    else {
      tapInstallFailed = true
      Self.log.error("Remote shortcut release correction could not install its event tap")
      recordRing(eventKind: 10, outcome: 2, mask: 0, subject: "uuremote_tap_install_failed")
      return
    }
    tapInstallFailed = false
    self.tap = tap
    self.source = source
    sequence.reset(keyboardIsClear: Self.keyboardIsClear)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    let check = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self else { return }
        let secure = IsSecureEventInputEnabled()
        if secure {
          self.sequence.reset()
          if !self.wasSecureInput {
            self.wasSecureInput = true
            self.recordRing(eventKind: 12, outcome: 1, mask: 0, subject: "secure_input_reset")
          }
        } else {
          self.wasSecureInput = false
        }
      }
    }
    secureCheck = check
    RunLoop.main.add(check, forMode: .common)
  }

  private func receive(_ type: CGEventType, event: CGEvent) {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
      sequence.reset()
      identity = nil
      tapDisabledCount = tapDisabledCount &+ 1
      if type == .tapDisabledByTimeout, let tap { CGEvent.tapEnable(tap: tap, enable: true) }
      recordRing(
        eventKind: 11, outcome: 2, mask: 0,
        subject: type == .tapDisabledByTimeout ? "tap_disabled_timeout" : "tap_disabled_user")
      return
    }
    guard !IsSecureEventInputEnabled() else {
      sequence.reset()
      if !wasSecureInput {
        wasSecureInput = true
        recordRing(eventKind: 12, outcome: 1, mask: 0, subject: "secure_input_reset")
      }
      return
    }
    wasSecureInput = false
    let pid = pid_t(truncatingIfNeeded: event.getIntegerValueField(.eventSourceUnixProcessID))
    guard isUURemote(pid) else {
      sequence.reset(
        keyboardIsClear: event.flags.intersection(Self.modifiers).isEmpty && Self.keyboardIsClear)
      return
    }
    let stale = sequence.observe(event, registered: registered)
    if !stale.isEmpty {
      event.flags.subtract(stale)
      Self.log.info("Corrected a stale Command flag in a UU shortcut release")
      recordRing(
        eventKind: 13, outcome: 1, mask: UInt32(truncatingIfNeeded: stale.rawValue),
        subject: "uuremote_command_repaired")
    }
  }

  private func isUURemote(_ pid: pid_t) -> Bool {
    guard pid > 0, pid != getpid(), let start = ProcessIdentity.start(of: pid) else { return false }
    if let identity, identity.pid == pid, identity.start == start { return identity.matches }
    if let identity, identity.pid == pid, identity.start != start { sequence.reset() }
    let matches =
      ProcessIdentity.executablePath(of: pid)?
      .hasSuffix("/UURemote.app/Contents/Helpers/UURemoteServer") == true
    identity = (pid, start, matches)
    return matches
  }

  private static var keyboardIsClear: Bool {
    [CGEventSourceStateID.hidSystemState, .combinedSessionState].allSatisfy { state in
      CGEventSource.flagsState(state).intersection(modifiers).isEmpty
        && !CGEventSource.keyState(state, key: CGKeyCode(kVK_Command))
        && !CGEventSource.keyState(state, key: CGKeyCode(kVK_RightCommand))
    }
  }

  @inline(__always)
  private func recordRing(eventKind: UInt8, outcome: UInt8, mask: UInt32, subject: StaticString) {
    guard let decisionRing else { return }
    var entry = HotKeyDecisionEntry()
    entry.uptimeNs = MonotonicTimestampAnchor.nowUptimeNs()
    entry.eventKind = eventKind
    entry.outcome = outcome
    entry.modifierFlagsMask = mask
    entry.tapDisabledCount = tapDisabledCount
    subject.withUTF8Buffer { utf8 in
      let str = String(decoding: utf8, as: UTF8.self)
      entry.subjectOrBundleId = InlineText64(truncatingUTF8: str)
    }
    decisionRing.append(entry)
  }

  private func stop() {
    secureCheck?.invalidate()
    secureCheck = nil
    wasSecureInput = false
    if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
    if let tap { CFMachPortInvalidate(tap) }
    source = nil
    tap = nil
    identity = nil
    sequence.reset()
  }

  isolated deinit {
    secureCheck?.invalidate()
    for observer in observers { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
    if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
    if let tap { CFMachPortInvalidate(tap) }
  }
}
