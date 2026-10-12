import AICore
import AppKit

/// Fires the double-tap shortcuts (``ModifierDoubleTap``) that ``HotKeyRegistrar`` registered:
/// while any is registered it watches modifier changes in other apps (a global monitor) and in
/// this one (a local monitor, which the global one never sees). Only modifier changes, as the
/// selection toolbar's listening does, so typing never wakes the app; a running count of key and
/// mouse presses shows what happened between two changes. A global monitor sees key events only
/// with Accessibility trust, which the registrar checks before registering a double-tap.
///
/// Unlike a Carbon hot key, a double-tap takes nothing away from other apps: the modifier's
/// events still reach the app in front. It has no hold either: it fires as the second tap comes
/// up, as a press and an immediate release, so a command's hold resolves as a plain tap.
final class ModifierTapMonitor {
  private var detector = ModifierDoubleTap()
  private var monitors: [Any] = []
  /// The registered double-taps' ids by modifier.
  private var entries: [TapModifier: String] = [:]
  private let onPress: @MainActor (String) -> Void
  private let onRelease: @MainActor (String) -> Void

  init(
    onPress: @escaping @MainActor (String) -> Void,
    onRelease: @escaping @MainActor (String) -> Void
  ) {
    self.onPress = onPress
    self.onRelease = onRelease
  }

  /// Watches for `entries`, or stops watching when there are none.
  func watch(_ entries: [TapModifier: String]) {
    self.entries = entries
    if entries.isEmpty {
      for monitor in monitors { NSEvent.removeMonitor(monitor) }
      monitors = []
      detector.reset()
    } else if monitors.isEmpty {
      let global = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
        MainActor.assumeIsolated { self?.modifiersChanged(event) }
      }
      let local = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
        MainActor.assumeIsolated { self?.modifiersChanged(event) }
        return event
      }
      monitors = [global, local].compactMap(\.self)
    }
  }

  private func modifiersChanged(_ event: NSEvent) {
    // The shell's own key presses (a write-back's ⌘V) are never the user's taps.
    guard !KeyPress.isSynthesized(event) else { return }
    let flags = event.modifierFlags
    let down = Set(Self.flags.compactMap { flags.contains($0.flag) ? $0.modifier : nil })
    guard
      let modifier = detector.update(
        down: down, others: flags.contains(.function), time: event.timestamp,
        inputs: Self.inputCount()),
      let id = entries[modifier]
    else { return }
    onPress(id)
    onRelease(id)
  }

  private static let flags: [(flag: NSEvent.ModifierFlags, modifier: TapModifier)] = [
    (.command, .command), (.option, .option), (.control, .control), (.shift, .shift),
  ]

  /// Key and mouse button presses the window server has seen, from any source: a change between
  /// two modifier changes means the modifier was used with something else.
  private static func inputCount() -> Int {
    let types: [CGEventType] = [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown]
    return types.reduce(0) { count, type in
      count &+ Int(CGEventSource.counterForEventType(.combinedSessionState, eventType: type))
    }
  }
}
