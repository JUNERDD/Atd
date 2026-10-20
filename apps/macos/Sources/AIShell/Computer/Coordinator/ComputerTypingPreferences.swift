import AICore
import AppKit
import MCP

/// Local opt-ins, independent of Commands and of the live pointer switch.
struct ComputerTypingOptions: Sendable {
  var typing = false
  var animation = false

  /// The browser follows the same grapheme boundaries and time budget as native Commands.
  /// It can skip overdue intermediate fills, but never split a composed character.
  func browserFeedback(_ text: String) -> Value {
    let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    var pace = TypingPace(text, typing: typing, reduceMotion: reduced, caretTracked: true)
    var elapsed = Duration.zero
    var end = 0
    var chunks: [Value] = []
    while let chunk = pace.next(at: elapsed) {
      end += chunk.text.utf16.count
      chunks.append(.object(["end": .int(end), "dueMs": .int(Int(chunk.due / .milliseconds(1)))]))
      elapsed = chunk.due
    }
    return .object([
      "chunks": .array(chunks), "highlight": .bool(animation), "reduceMotion": .bool(reduced),
      "increaseContrast": .bool(NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast),
    ])
  }
}

final class ComputerTypingPreferences {
  private static let typingKey = "computer.typing"
  private static let animationKey = "computer.typingAnimation"
  private let defaults: UserDefaults

  init(defaults: UserDefaults) { self.defaults = defaults }

  var options: ComputerTypingOptions {
    ComputerTypingOptions(
      typing: defaults.bool(forKey: Self.typingKey),
      animation: defaults.bool(forKey: Self.animationKey))
  }

  func set(_ change: ComputerSetTypingParams) {
    switch change.setting {
    case .typing:
      defaults.set(change.enabled, forKey: Self.typingKey)
      if change.enabled, defaults.object(forKey: Self.animationKey) == nil {
        defaults.set(true, forKey: Self.animationKey)
      }
    case .animation:
      defaults.set(change.enabled, forKey: Self.animationKey)
    }
  }
}
