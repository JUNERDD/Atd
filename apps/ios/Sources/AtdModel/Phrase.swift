import Foundation

/// A saved phrase the keyboard inserts in one tap. Phrases work offline: the keyboard keeps a copy
/// in its own container, so they stay available without Full Access.
public struct Phrase: Codable, Sendable, Identifiable, Equatable, Hashable {
  public var id: String
  /// The short name the ✦ line finds it by (到了 matches dl).
  public var title: String
  public var text: String

  public init(id: String = UUID().uuidString, title: String, text: String) {
    self.id = id
    self.title = title
    self.text = text
  }

  /// The phrases a new phrase book starts with, in the language it is first created in.
  public static func builtins() -> [Phrase] {
    [
      Phrase(
        id: "arrived", title: String(localized: "phrase.arrived.title", bundle: .module),
        text: String(localized: "phrase.arrived.text", bundle: .module)),
      Phrase(
        id: "moment", title: String(localized: "phrase.moment.title", bundle: .module),
        text: String(localized: "phrase.moment.text", bundle: .module)),
      Phrase(
        id: "thanks", title: String(localized: "phrase.thanks.title", bundle: .module),
        text: String(localized: "phrase.thanks.text", bundle: .module)),
    ]
  }
}
