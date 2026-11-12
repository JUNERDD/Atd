import AICore
import AppKit
import Carbon.HIToolbox

/// Recognizes one verified remote source's malformed release tail without posting or changing
/// events. The caller owns source identity, tap coverage and the registered shortcut snapshot.
struct RemoteModifierSequence {
  private struct Modifier {
    let key: CGKeyCode
    let flag: CGEventFlags
    let carbon: HotKeyModifiers
  }

  private struct Chord {
    let command: CGKeyCode
    let other: Modifier
    let key: CGKeyCode

    var flags: CGEventFlags { [.maskCommand, other.flag] }
    var combination: HotKeyCombination {
      HotKeyCombination(keyCode: UInt32(key), modifiers: [.command, other.carbon])
    }
  }

  private enum Phase {
    case unknown
    case clear
    case command(CGKeyCode)
    case modifiers(CGKeyCode, Modifier)
    case triggered(Chord)
    case released(Chord, CGEventTimestamp)
  }

  private static let shortcutFlags: CGEventFlags = [
    .maskCommand, .maskShift, .maskAlternate, .maskControl,
  ]
  private static let commandDeviceBits: UInt64 = 0x18
  private static let candidateLimit: CGEventTimestamp = 3_000_000_000
  private static let releaseTail: CGEventTimestamp = 100_000_000
  private var phase = Phase.unknown
  private var sourcePID: Int64?
  private var lastTimestamp: CGEventTimestamp?
  private var candidateStarted: CGEventTimestamp?

  /// Only an explicit clear keyboard snapshot may start a new observation at a known baseline.
  /// A coverage gap, other source or invalid sequence otherwise discards all repair eligibility.
  mutating func reset(keyboardIsClear: Bool = false) {
    phase = keyboardIsClear ? .clear : .unknown
    sourcePID = nil
    lastTimestamp = nil
    candidateStarted = nil
  }

  /// Returns only the Command bit to remove from this event, or no change. The caller must
  /// supply only the verified remote process's keyboard events and reset on every coverage gap
  /// or other source. Ordinary typing is neither retained nor used to authorize a repair.
  mutating func observe(
    _ event: CGEvent, registered: Set<HotKeyCombination>
  ) -> CGEventFlags {
    guard [.flagsChanged, .keyDown, .keyUp].contains(event.type) else {
      reset()
      return []
    }
    let pid = event.getIntegerValueField(.eventSourceUnixProcessID)
    guard pid > 0 else {
      reset()
      return []
    }
    if let sourcePID, sourcePID != pid { reset() }
    if let lastTimestamp, event.timestamp < lastTimestamp { reset() }
    sourcePID = pid
    lastTimestamp = event.timestamp
    let key = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
    let flags = event.flags.intersection(Self.shortcutFlags)
    let deviceBits = event.flags.rawValue & Self.commandDeviceBits
    // A quiet or unobserved interval must not preserve a candidate indefinitely. Expiry only
    // removes permission to repair; it never releases a key or changes the arriving event.
    if let candidateStarted, event.timestamp - candidateStarted > Self.candidateLimit {
      discard(after: event)
      return []
    }

    switch phase {
    case .unknown:
      if event.type == .flagsChanged, flags.isEmpty, deviceBits == 0 { phase = .clear }
    case .clear:
      // Plain keys do not change a known modifier baseline. Once a modifier sequence starts,
      // an unrelated press invalidates it instead of becoming a shortcut candidate.
      if flags.isEmpty, deviceBits == 0 { return [] }
      if event.type == .flagsChanged, Self.isCommand(key), flags == .maskCommand,
        Self.commandSideMatches(key, deviceBits: deviceBits)
      {
        phase = .command(key)
        candidateStarted = event.timestamp
      } else {
        discard(after: event)
      }
    case .command(let command):
      if event.type == .flagsChanged, let other = Self.otherModifier(key),
        flags == [.maskCommand, other.flag],
        Self.commandSideMatches(command, deviceBits: deviceBits)
      {
        phase = .modifiers(command, other)
      } else {
        discard(after: event)
      }
    case .modifiers(let command, let other):
      let chord = Chord(command: command, other: other, key: key)
      if event.type == .keyDown,
        event.getIntegerValueField(.keyboardEventAutorepeat) == 0,
        !Self.isCommand(key), Self.otherModifier(key) == nil,
        flags == chord.flags, Self.commandSideMatches(command, deviceBits: deviceBits),
        registered.contains(chord.combination)
      {
        phase = .triggered(chord)
      } else {
        discard(after: event)
      }
    case .triggered(let chord):
      guard registered.contains(chord.combination), flags.subtracting(chord.flags).isEmpty,
        deviceBits == 0
          || (flags.contains(.maskCommand)
            && Self.commandSideMatches(chord.command, deviceBits: deviceBits))
      else {
        discard(after: event)
        return []
      }
      if Self.isMainKeyTail(event, key: key, chord: chord) { return [] }
      if event.type == .flagsChanged, key == chord.command, flags == chord.other.flag,
        deviceBits == 0
      {
        phase = .released(chord, event.timestamp)
      } else {
        discard(after: event)
      }
    case .released(let chord, let at):
      guard event.timestamp >= at, event.timestamp - at <= Self.releaseTail,
        registered.contains(chord.combination), flags.subtracting(chord.flags).isEmpty,
        deviceBits == 0
      else {
        discard(after: event)
        return []
      }
      // The main key may come up before either modifier. It cannot consume the release tail,
      // and its potentially stale flags are not evidence that Command was pressed again.
      if Self.isMainKeyTail(event, key: key, chord: chord) { return [] }
      guard event.type == .flagsChanged, key == chord.other.key,
        flags == .maskCommand || flags.isEmpty
      else {
        discard(after: event)
        return []
      }
      phase = .clear
      candidateStarted = nil
      return flags == .maskCommand ? .maskCommand : []
    }
    return []
  }

  private mutating func discard(after event: CGEvent) {
    candidateStarted = nil
    phase =
      event.type == .flagsChanged
        && event.flags.intersection(Self.shortcutFlags).isEmpty
        && event.flags.rawValue & Self.commandDeviceBits == 0 ? .clear : .unknown
  }

  private static func isMainKeyTail(_ event: CGEvent, key: CGKeyCode, chord: Chord) -> Bool {
    key == chord.key
      && (event.type == .keyUp
        || (event.type == .keyDown && event.getIntegerValueField(.keyboardEventAutorepeat) != 0))
  }

  private static func isCommand(_ key: CGKeyCode) -> Bool {
    Int(key) == kVK_Command || Int(key) == kVK_RightCommand
  }

  private static func commandSideMatches(_ key: CGKeyCode, deviceBits: UInt64) -> Bool {
    // Remote events may omit device-dependent flags. If present, they must describe exactly
    // the single Command side observed since the clear baseline, never an unseen second side.
    deviceBits == 0 || deviceBits == (Int(key) == kVK_Command ? 0x08 : 0x10)
  }

  private static func otherModifier(_ key: CGKeyCode) -> Modifier? {
    switch Int(key) {
    case kVK_Shift, kVK_RightShift: Modifier(key: key, flag: .maskShift, carbon: .shift)
    case kVK_Option, kVK_RightOption: Modifier(key: key, flag: .maskAlternate, carbon: .option)
    case kVK_Control, kVK_RightControl: Modifier(key: key, flag: .maskControl, carbon: .control)
    default: nil
    }
  }
}
