import AtdModel
import Foundation

/// One request to a model: the system prompt, the conversation so far and an output ceiling.
/// `CommandPrompt` and `AskPrompt` build every request the app and the keyboard send.
public struct ModelRequest: Sendable, Equatable {
  /// Low enough that a new key's rate limits accept it (providers count the ceiling against the
  /// per-minute output budget before the answer starts), high enough that a model which thinks
  /// before answering still finishes a phone-length rewrite or answer.
  public static let defaultMaxOutputTokens = 8_000

  /// Stable across turns of one conversation for gateways that route by session.
  public var conversationID: UUID?
  public var system: String
  /// Alternating turns that start and end with the person's.
  public var messages: [ModelMessage]
  /// The output ceiling. Only the Anthropic protocol requires one; OpenAI-compatible requests
  /// leave it to the provider, whose parameter name and range differ by model.
  public var maxOutputTokens: Int

  public init(
    system: String, messages: [ModelMessage], maxOutputTokens: Int = defaultMaxOutputTokens
  ) {
    self.system = system
    self.messages = messages
    self.maxOutputTokens = maxOutputTokens
  }
}

public struct ModelMessage: Sendable, Equatable {
  public enum Role: String, Sendable {
    case user
    case assistant
  }

  public var role: Role
  public var text: String
  /// Photos attached to a question; only the person's turns carry them.
  public var images: [ModelImage]

  public init(_ role: Role, _ text: String, images: [ModelImage] = []) {
    self.role = role
    self.text = text
    self.images = images
  }
}

/// An encoded image sent inline with a message.
public struct ModelImage: Sendable, Equatable {
  public var data: Data
  /// `image/jpeg`, `image/png`…
  public var mediaType: String

  public init(data: Data, mediaType: String) {
    self.data = data
    self.mediaType = mediaType
  }
}

/// A model reached through one provider protocol.
public protocol ModelBackend: Sendable {
  /// Streams the answer as text deltas. The stream finishes when the answer is complete, or
  /// throws a `ModelFailure`; cancelling the consuming task cancels the request.
  func stream(_ request: ModelRequest) -> AsyncThrowingStream<String, any Error>
}

/// What the keyboard and the app run requests through: it picks the model a command asks for
/// (or the default one), so callers and their tests only deal in requests and deltas.
public protocol TextGenerating: Sendable {
  /// Streams the answer from the model `choice` resolves to. Fails with `ModelFailure.noModel`
  /// when no connection is configured, and otherwise as `ModelBackend.stream` does.
  func stream(_ request: ModelRequest, choice: ModelChoice) -> AsyncThrowingStream<
    String, any Error
  >
}

extension AsyncThrowingStream where Failure == any Error {
  /// A stream that fails before producing anything.
  static func failing(_ error: any Error) -> Self {
    AsyncThrowingStream { $0.finish(throwing: error) }
  }
}
