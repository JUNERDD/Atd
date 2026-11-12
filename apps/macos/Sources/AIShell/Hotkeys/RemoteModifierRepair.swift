import AICore
import AppKit
import Carbon.HIToolbox
import OSLog

/// UU can reintroduce a released Command flag on the next modifier's release. Correct only
/// that observed event at the HID boundary, before its flags enter the system state again.
/// This never posts keys or clears an existing state without its complete release sequence.
final class RemoteModifierRepair {
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
      Self.log.error("Remote shortcut release correction could not install its event tap")
      return
    }
    self.tap = tap
    self.source = source
    sequence.reset(keyboardIsClear: Self.keyboardIsClear)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    // Secure input can suppress events without delivering a tap-disabled callback. Never
    // carry a partial chord through that silent gap.
    let check = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated {
        if IsSecureEventInputEnabled() { self?.sequence.reset() }
      }
    }
    secureCheck = check
    RunLoop.main.add(check, forMode: .common)
  }

  private func receive(_ type: CGEventType, event: CGEvent) {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
      sequence.reset()
      identity = nil
      if type == .tapDisabledByTimeout, let tap { CGEvent.tapEnable(tap: tap, enable: true) }
      return
    }
    guard !IsSecureEventInputEnabled() else {
      sequence.reset()
      return
    }
    let pid = pid_t(truncatingIfNeeded: event.getIntegerValueField(.eventSourceUnixProcessID))
    guard isUURemote(pid) else {
      // Another source may be holding either Command key. Its clean event can establish a
      // baseline only when the system independently reports that all shortcut keys are up.
      sequence.reset(
        keyboardIsClear: event.flags.intersection(Self.modifiers).isEmpty && Self.keyboardIsClear)
      return
    }
    let stale = sequence.observe(event, registered: registered)
    if !stale.isEmpty {
      event.flags.subtract(stale)
      Self.log.info("Corrected a stale Command flag in a UU shortcut release")
    }
  }

  /// Bind the observed PID to its current kernel start time and executable, including after a
  /// UU restart or PID reuse. No process identity supplied in an event is trusted by itself.
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

  private func stop() {
    secureCheck?.invalidate()
    secureCheck = nil
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
