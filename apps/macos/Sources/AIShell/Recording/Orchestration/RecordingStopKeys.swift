import AICore
import Carbon.HIToolbox

/// The recording's own keys (architecture B3, P2-7): ⌃⌘Esc stops it from any app, and Escape
/// cancels its countdown. They are Carbon hot keys under a signature of their own, apart from the
/// global shortcuts' and the island's Escape, and they are held only while a recording counts
/// down, records or is paused, so both combinations belong to the other apps the rest of the
/// time. A combination another registration of this process holds stays with it (Escape while
/// the island cancels a command); the other key still works then.
final class RecordingStopKeys {
  /// 'AIRC'.
  private static let signature: OSType = 0x4149_5243
  private static let stopCombination = HotKeyCombination(
    keyCode: UInt32(kVK_Escape), modifiers: [.control, .command])
  private static let escapeCombination = HotKeyCombination(
    keyCode: UInt32(kVK_Escape), modifiers: [])

  /// ⌃⌘Esc.
  var onStop: (() -> Void)?
  /// Escape, during the countdown only.
  var onEscape: (() -> Void)?
  private let keys = CarbonHotKeys(signature: RecordingStopKeys.signature)
  private var stop: UInt32?
  private var escape: UInt32?

  /// Holds ⌃⌘Esc, and Escape as well while `countingDown`.
  func hold(countingDown: Bool) {
    if stop == nil {
      stop = register(Self.stopCombination) { [weak self] in self?.onStop?() }
    }
    if countingDown, escape == nil {
      escape = register(Self.escapeCombination) { [weak self] in self?.onEscape?() }
    } else if !countingDown, let escape {
      keys.unregister(escape)
      self.escape = nil
    }
  }

  /// Gives both combinations back.
  func release() {
    for token in [stop, escape].compactMap(\.self) { keys.unregister(token) }
    stop = nil
    escape = nil
  }

  private func register(
    _ combination: HotKeyCombination, _ action: @escaping @MainActor () -> Void
  ) -> UInt32? {
    guard case .success(let token) = keys.register(combination, onPress: action) else {
      return nil
    }
    return token
  }
}
