import AICore
import AppKit
import Carbon.HIToolbox

/// The keyboard must be released before its owner changes or a synthesized chord is posted.
/// Session state includes remote input; HID state alone only covers hardware sources. Never
/// clear either state by posting releases: those keys belong to the user or their input source.
enum ShortcutRelease {
  private static let sources: [CGEventSourceStateID] = [.hidSystemState, .combinedSessionState]
  private static let interval: Duration = .milliseconds(16)
  private static let settle: Duration = .milliseconds(32)
  /// Only keys Atd actually received, or that triggered one of its global shortcuts. Remote
  /// sources can leave unrelated key-state bits stale, so scanning every possible key blocks
  /// transfers even when their shortcut has been released.
  private static var mainKeys: Set<CGKeyCode> = []
  private static var observingModifiers = false
  private static var knownModifiers: NSEvent.ModifierFlags = []
  private static var heldModifiers: NSEvent.ModifierFlags = []

  static func pressed(_ key: CGKeyCode) { mainKeys.insert(key) }

  /// An observed release is authoritative even when a remote source leaves its state bit set.
  static func released(_ key: CGKeyCode) { mainKeys.remove(key) }

  /// Observation is valid only while both local and global modifier events can be received.
  /// Losing that coverage discards releases that could otherwise hide a later unseen press.
  static func setModifierObservation(active: Bool) {
    observingModifiers = active
    if !active {
      knownModifiers = []
      heldModifiers = []
    }
  }

  static func modifiersChanged(_ event: NSEvent) {
    guard observingModifiers, event.type == .flagsChanged, !KeyPress.isSynthesized(event) else {
      return
    }
    let modifier: NSEvent.ModifierFlags
    switch Int(event.keyCode) {
    case kVK_Command, kVK_RightCommand: modifier = .command
    case kVK_Shift, kVK_RightShift: modifier = .shift
    case kVK_Option, kVK_RightOption: modifier = .option
    case kVK_Control, kVK_RightControl: modifier = .control
    default: return
    }
    // Other families in this event can be stale. The changed family's aggregate bit remains
    // set when one side is released while the other is still held.
    knownModifiers.insert(modifier)
    if event.modifierFlags.contains(modifier) {
      heldModifiers.insert(modifier)
    } else {
      heldModifiers.remove(modifier)
    }
  }

  /// Synthesized input still requires the system's own modifier state to be clear.
  static var isHeld: Bool {
    mainKeyHeld || CopyFallback.shortcutModifiersHeld(rawModifierFlags)
  }

  private static var isHeldForHandoff: Bool {
    let flags =
      (rawModifierFlags & ~UInt64(knownModifiers.rawValue)) | UInt64(heldModifiers.rawValue)
    return mainKeyHeld || CopyFallback.shortcutModifiersHeld(flags)
  }

  private static var rawModifierFlags: UInt64 {
    sources.reduce(0) { $0 | CGEventSource.flagsState($1).rawValue }
  }

  private static var mainKeyHeld: Bool {
    // A release may go to another app, or the shortcut may be unregistered while held. Poll
    // only the keys already observed, without needing a global ordinary-key press monitor.
    mainKeys = mainKeys.filter { key in
      sources.contains { CGEventSource.keyState($0, key: key) }
    }
    return !mainKeys.isEmpty
  }

  /// Focus transfers and shortcut re-registration may trust an observed modifier release even
  /// when a later ordinary key-up writes stale flags back into the system's cached state.
  static func waitForHandoff(
    until deadline: ContinuousClock.Instant? = nil, isValid: () -> Bool = { true }
  ) async -> Bool {
    await wait(until: deadline, isValid: isValid, held: { isHeldForHandoff })
  }

  /// A short quiet interval lets queued releases reach the old owner, including a remote
  /// key-up that arrives just after its modifier-up. Cancellation and a deadline never force
  /// a handoff through held keys.
  static func wait(
    until deadline: ContinuousClock.Instant? = nil, isValid: () -> Bool = { true }
  ) async -> Bool {
    await wait(until: deadline, isValid: isValid, held: { isHeld })
  }

  private static func wait(
    until deadline: ContinuousClock.Instant?, isValid: () -> Bool, held: () -> Bool
  ) async -> Bool {
    var releasedAt: ContinuousClock.Instant?
    while !Task.isCancelled, isValid() {
      let now = ContinuousClock.now
      if let deadline, now >= deadline { return false }
      if held() {
        releasedAt = nil
      } else if let releasedAt {
        if now - releasedAt >= settle { return true }
      } else {
        releasedAt = now
      }
      do { try await Task.sleep(for: interval) } catch { return false }
    }
    return false
  }
}
