import AICore
import AppKit
import Foundation
import OSLog

/// Keeps the registered global hot keys equal to the set the page pushes, one diff at a time:
/// chords with Carbon (``CarbonHotKeys``), double-taps with ``ModifierTapMonitor``, both calling
/// the same press and release handlers. Nothing is cached across launches (grill decision Q9):
/// the panel page loads at launch and pushes the set, and until then no shortcut is registered.
final class HotKeyRegistrar {
  private enum Registration {
    case chord(HotKeyCombination, token: UInt32)
    case doubleTap(TapModifier)

    var trigger: HotKeyTrigger {
      switch self {
      case .chord(let combination, _): .chord(combination)
      case .doubleTap(let modifier): .doubleTap(modifier)
      }
    }
  }

  private static let allowedModifierFlags: NSEvent.ModifierFlags = [
    .command, .option, .control, .shift, .function,
  ]

  let decisionRing: HotKeyDecisionRing?
  var onLiveProbeShortcut:
    ((_ shortcutId: String?, _ modifierMask: Int, _ outcome: String) -> Void)?

  private let carbon = CarbonHotKeys()
  private let remoteModifiers = RemoteModifierRepair()
  private var taps: ModifierTapMonitor!
  private var registered: [String: Registration] = [:]
  private var desired: [ShortcutRegistration] = []
  private var recording: [ObjectIdentifier: Set<Int>] = [:]
  private var resuming: Task<Void, Never>?
  private var pending:
    [(desired: [ShortcutRegistration], continuation: CheckedContinuation<[ShortcutResult], Never>)] =
      []
  private let onPress: @MainActor (String) -> Void
  private let onRelease: @MainActor (String) -> Void
  private let canWatchKeyboard: () -> Bool
  private var localKeys: Any?
  private var externalReleases: Any?

  var hasGlobalMonitor: Bool { externalReleases != nil }
  var uuremoteTapInstallFailed: Bool { remoteModifiers.tapInstallFailed }

  init(
    canWatchKeyboard: @escaping () -> Bool,
    decisionRing: HotKeyDecisionRing? = nil,
    onPress: @escaping @MainActor (String) -> Void,
    onRelease: @escaping @MainActor (String) -> Void
  ) {
    self.canWatchKeyboard = canWatchKeyboard
    self.decisionRing = decisionRing
    self.onPress = onPress
    self.onRelease = onRelease
    remoteModifiers.decisionRing = decisionRing
    taps = ModifierTapMonitor(
      onPress: { [weak self] id in self?.handleTriggeredPress(id, isDoubleTap: true) },
      onRelease: onRelease)
    watchKeys()
  }

  isolated deinit {
    resuming?.cancel()
    if let localKeys { NSEvent.removeMonitor(localKeys) }
    if let externalReleases { NSEvent.removeMonitor(externalReleases) }
    ShortcutRelease.setModifierObservation(active: false)
  }

  private func watchKeys() {
    if localKeys == nil {
      localKeys = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp, .flagsChanged]) {
        [weak self] event in
        MainActor.assumeIsolated {
          if !KeyPress.isSynthesized(event) {
            if event.type == .keyUp {
              ShortcutRelease.released(event.keyCode)
            } else if event.type == .flagsChanged {
              ShortcutRelease.modifiersChanged(event)
            } else if self?.recording.isEmpty == false, !event.isARepeat {
              ShortcutRelease.pressed(event.keyCode)
            }
          }
        }
        return event
      }
    }
    if canWatchKeyboard(), externalReleases == nil {
      externalReleases = NSEvent.addGlobalMonitorForEvents(matching: [.keyUp, .flagsChanged]) {
        event in
        MainActor.assumeIsolated {
          guard !KeyPress.isSynthesized(event) else { return }
          if event.type == .keyUp {
            ShortcutRelease.released(event.keyCode)
          } else {
            ShortcutRelease.modifiersChanged(event)
          }
        }
      }
    } else if !canWatchKeyboard(), let externalReleases {
      NSEvent.removeMonitor(externalReleases)
      self.externalReleases = nil
    }
    ShortcutRelease.setModifierObservation(
      active: canWatchKeyboard() && localKeys != nil && externalReleases != nil)
    refreshRemoteModifiers()
  }

  func apply(_ desired: [ShortcutRegistration]) async -> [ShortcutResult] {
    self.desired = desired
    guard recording.isEmpty, resuming == nil else {
      return await withCheckedContinuation { pending.append((desired, $0)) }
    }
    return register(desired)
  }

  private func register(_ desired: [ShortcutRegistration]) -> [ShortcutResult] {
    let plan = HotKeyPlanner.plan(
      desired: desired, registered: registered.mapValues(\.trigger),
      reserved: CarbonHotKeys.reservedBySystem(), doubleTapAvailable: canWatchKeyboard())
    for id in plan.unregister {
      if case .chord(_, let token) = registered.removeValue(forKey: id) {
        carbon.unregister(token)
      }
    }
    var failures = plan.failures
    for (id, trigger) in plan.register {
      switch trigger {
      case .chord(let combination):
        let registration = carbon.register(
          combination,
          onPress: { [weak self] in self?.handleTriggeredPress(id, isDoubleTap: false) },
          onRelease: { [onRelease] in onRelease(id) })
        switch registration {
        case .success(let token): registered[id] = .chord(combination, token: token)
        case .failure(let status): failures[id] = .registrationFailed(status: status.value)
        }
      case .doubleTap(let modifier):
        registered[id] = .doubleTap(modifier)
      }
    }
    taps.watch(
      registered.reduce(into: [:]) { entries, entry in
        if case .doubleTap(let modifier) = entry.value { entries[modifier] = entry.key }
      })
    refreshRemoteModifiers()
    var reported: Set<String> = []
    return desired.compactMap { request in
      guard reported.insert(request.id).inserted else { return nil }
      guard let failure = failures[request.id] else { return .registered(.init(id: request.id)) }
      Self.log.info(
        "Shortcut \(request.id, privacy: .public) not registered: \(Self.detail(failure))")
      recordDecision(
        eventKind: 2, outcome: 2, elapsedMs: 0, flags: Self.failureCode(failure),
        subject: request.id)
      return .notRegistered(.init(id: request.id, reason: failure.reason))
    }
  }

  func reapply() {
    watchKeys()
    if recording.isEmpty, resuming == nil { _ = register(desired) }
  }

  func displayLabel(for id: String) -> String? {
    guard registered[id] != nil,
      let accelerator = desired.first(where: { $0.id == id })?.accelerator
    else { return nil }
    return try? Accelerator.label(accelerator)
  }

  func startRecording(owner: ObjectIdentifier, session: Int) {
    resuming?.cancel()
    resuming = nil
    if recording.isEmpty {
      unregisterAll()
      recordDecision(eventKind: 3, outcome: 0, elapsedMs: 0, flags: 0, subject: "recording_suspend")
    }
    recording[owner, default: []].insert(session)
  }

  @discardableResult
  func stopRecording(owner: ObjectIdentifier, session: Int? = nil) -> Bool {
    guard var sessions = recording[owner] else { return false }
    if let session { sessions.remove(session) } else { sessions.removeAll() }
    if sessions.isEmpty {
      recording.removeValue(forKey: owner)
    } else {
      recording[owner] = sessions
    }
    return resumeIfReady()
  }

  @discardableResult
  func cancelRecordings() -> Bool {
    guard !recording.isEmpty else { return false }
    recording.removeAll()
    return resumeIfReady()
  }

  private func resumeIfReady() -> Bool {
    guard recording.isEmpty else { return false }
    resuming?.cancel()
    let startedNs = MonotonicTimestampAnchor.nowUptimeNs()
    resuming = Task { [weak self] in
      let settled = await ShortcutRelease.waitForHandoff()
      guard let self else { return }
      let ms = UInt16(
        clamping: (MonotonicTimestampAnchor.nowUptimeNs() &- startedNs) / 1_000_000)
      self.recordDecision(
        eventKind: 4, outcome: settled ? 0 : 2, elapsedMs: ms, flags: 0,
        subject: settled ? "recording_resumed" : "handoff_aborted")
      guard settled else { return }
      resuming = nil
      resumeRegistrations()
    }
    return true
  }

  private func resumeRegistrations() {
    let waiting = pending
    pending = []
    if waiting.isEmpty { _ = register(desired) }
    for request in waiting {
      request.continuation.resume(returning: register(request.desired))
    }
  }

  private func handleTriggeredPress(_ id: String, isDoubleTap: Bool) {
    let modMask = Self.sanitizedModifierMask(NSEvent.modifierFlags)
    recordDecision(
      eventKind: 1, outcome: 0, elapsedMs: 0, flags: isDoubleTap ? 2 : 1, subject: id,
      modifierMask: modMask)
    onLiveProbeShortcut?(id, Int(modMask), isDoubleTap ? "double_tap_triggered" : "chord_triggered")
    onPress(id)
  }

  static func sanitizedModifierMask(_ flags: NSEvent.ModifierFlags) -> UInt32 {
    UInt32(truncatingIfNeeded: flags.intersection(allowedModifierFlags).rawValue)
  }

  @inline(__always)
  private func recordDecision(
    eventKind: UInt8, outcome: UInt8, elapsedMs: UInt16, flags: UInt8, subject: String,
    modifierMask: UInt32? = nil
  ) {
    guard let decisionRing else { return }
    var entry = HotKeyDecisionEntry()
    entry.uptimeNs = MonotonicTimestampAnchor.nowUptimeNs()
    entry.subjectOrBundleId = InlineText64(truncatingUTF8: subject)
    entry.frontmostPid = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
    entry.modifierFlagsMask = modifierMask ?? Self.sanitizedModifierMask(NSEvent.modifierFlags)
    entry.elapsedMs = elapsedMs
    entry.tapDisabledCount = remoteModifiers.tapDisabledCount
    entry.eventKind = eventKind
    entry.outcome = outcome
    entry.flags = flags
    decisionRing.append(entry)
  }

  private static let log = Logger(subsystem: "com.junerdd.ai", category: "hotkeys")

  private static func failureCode(_ failure: HotKeyFailure) -> UInt8 {
    switch failure {
    case .invalidAccelerator: 1
    case .reservedBySystem: 2
    case .sameCombination: 3
    case .registrationFailed: 4
    case .needsAccessibility: 5
    }
  }

  private static func detail(_ failure: HotKeyFailure) -> String {
    switch failure {
    case .invalidAccelerator(let error): "invalid accelerator (\(error))"
    case .reservedBySystem: "reserved by a macOS keyboard shortcut"
    case .sameCombination(let holder): "same combination as \(holder)"
    case .registrationFailed(let status): "RegisterEventHotKey \(CarbonStatus(value: status).name)"
    case .needsAccessibility: "a double-tap needs Accessibility access to watch the keyboard"
    }
  }

  func unregisterAll() {
    for case .chord(_, let token) in registered.values { carbon.unregister(token) }
    registered.removeAll()
    taps.watch([:])
    refreshRemoteModifiers()
  }

  private func refreshRemoteModifiers() {
    let chords = Set(
      registered.values.compactMap { registration -> HotKeyCombination? in
        if case .chord(let combination, _) = registration { return combination }
        return nil
      })
    remoteModifiers.watch(chords, trusted: canWatchKeyboard())
  }
}
