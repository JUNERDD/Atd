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

  private let carbon = CarbonHotKeys()
  private let remoteModifiers = RemoteModifierRepair()
  private let taps: ModifierTapMonitor
  private var registered: [String: Registration] = [:]
  /// The set last pushed, which ``reapply()`` registers again.
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

  /// `onPress` receives the id of the pressed entry, `onRelease` that of the entry whose key
  /// came back up. `canWatchKeyboard`: whether the app has Accessibility trust, without which a
  /// double-tap cannot be detected.
  init(
    canWatchKeyboard: @escaping () -> Bool,
    onPress: @escaping @MainActor (String) -> Void,
    onRelease: @escaping @MainActor (String) -> Void
  ) {
    self.canWatchKeyboard = canWatchKeyboard
    self.onPress = onPress
    self.onRelease = onRelease
    taps = ModifierTapMonitor(onPress: onPress, onRelease: onRelease)
    watchKeys()
  }

  isolated deinit {
    resuming?.cancel()
    if let localKeys { NSEvent.removeMonitor(localKeys) }
    if let externalReleases { NSEvent.removeMonitor(externalReleases) }
    ShortcutRelease.setModifierObservation(active: false)
  }

  /// Records a chord's actual press before renderer recording completes. Ordinary typing and
  /// repeats after recording ended never become keys a later handoff waits for. Releases still
  /// clear known keys after completion or focus loss; only virtual codes are retained.
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

  /// Registers the difference to `desired` and reports every entry once, in order. The page
  /// words failures by reason; the details go to the log.
  func apply(_ desired: [ShortcutRegistration]) async -> [ShortcutResult] {
    self.desired = desired
    guard recording.isEmpty, resuming == nil else {
      // Do not claim registration succeeded while listeners are suspended. Each caller gets the
      // real OS result after recording ends; the last request remains the desired set.
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
          combination, onPress: { [onPress] in onPress(id) },
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
      return .notRegistered(.init(id: request.id, reason: failure.reason))
    }
  }

  /// Registers the last pushed set again, as when Accessibility trust changed: a double-tap
  /// registers once the app is trusted and is released when it no longer is. The page learns
  /// the outcome from its own next push.
  func reapply() {
    watchKeys()
    if recording.isEmpty, resuming == nil { _ = register(desired) }
  }

  /// Hints describe an active registration, never an unavailable default or failed binding.
  func displayLabel(for id: String) -> String? {
    guard registered[id] != nil,
      let accelerator = desired.first(where: { $0.id == id })?.accelerator
    else { return nil }
    return try? Accelerator.label(accelerator)
  }

  /// Multiple recorders/windows can coexist; only releasing the last one restores shortcuts.
  func startRecording(owner: ObjectIdentifier, session: Int) {
    resuming?.cancel()
    resuming = nil
    if recording.isEmpty { unregisterAll() }
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
    resuming = Task { [weak self] in
      guard await ShortcutRelease.waitForHandoff(), let self else { return }
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

  private static let log = Logger(subsystem: "com.junerdd.ai", category: "hotkeys")

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
