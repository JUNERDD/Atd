import AtdModel
import Foundation

/// `POST {baseURL}/chat/completions` with `stream: true`: OpenAI, and the providers and servers
/// that speak its API (Gemini's compatible endpoint, DeepSeek, OpenRouter, Qwen, a custom one).
///
/// Only `choices[0].delta.content` is read; reasoning that some providers stream alongside it
/// (`reasoning_content`) is not part of the answer.
public struct OpenAICompatibleClient: ModelBackend {
  public var baseURL: URL
  public var apiKey: String
  public var model: String
  var effort: ReasoningEffort?
  var session: URLSession
  var headDeadline = HTTPStream.headDeadline

  public init(baseURL: URL, apiKey: String, model: String, session: URLSession = .models) {
    self.baseURL = baseURL
    self.apiKey = apiKey
    self.model = model
    self.session = session
  }

  public func stream(_ request: ModelRequest) -> AsyncThrowingStream<String, any Error> {
    let post: URLRequest
    do {
      post = try urlRequest(for: request)
    } catch {
      return .failing(ModelFailure.from(error))
    }
    return HTTPStream.answer(
      post, session: session, headDeadline: headDeadline, decoder: OpenAIAnswerDecoder())
  }

  /// The models the endpoint lists (`GET {baseURL}/models`), in its order.
  public func models() async throws -> [ModelInfo] {
    var get = URLRequest(url: baseURL.appending(path: "models"))
    get.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
    let list = try await HTTPStream.json(
      get, session: session, as: ModelList.self, failure: OpenAIAnswerDecoder.failure)
    return list.data.map { ModelInfo(id: $0.id, name: $0.name) }
  }

  func urlRequest(for request: ModelRequest) throws -> URLRequest {
    try openAIPost(
      url: baseURL.appending(path: "chat/completions"), key: apiKey,
      conversation: request.conversationID,
      body: ChatRequest(model: model, request: request, reasoningEffort: effort))
  }
}

/// The request body. A turn without images sends its text as a plain string, which every
/// compatible server accepts; one with images sends parts.
struct ChatRequest: Encodable {
  struct Message: Encodable {
    var role: String
    var content: Content
  }

  enum Content: Encodable {
    case text(String)
    case parts([Part])

    func encode(to encoder: any Encoder) throws {
      var container = encoder.singleValueContainer()
      switch self {
      case .text(let text): try container.encode(text)
      case .parts(let parts): try container.encode(parts)
      }
    }
  }

  struct Part: Encodable {
    struct ImageURL: Encodable { var url: String }
    var type: String
    var text: String?
    var imageUrl: ImageURL?
  }

  var model: String
  var reasoningEffort: ReasoningEffort?
  var stream = true
  var messages: [Message]

  init(model: String, request: ModelRequest, reasoningEffort: ReasoningEffort?) {
    self.reasoningEffort = reasoningEffort
    self.model = model
    let system =
      request.system.isEmpty ? [] : [Message(role: "system", content: .text(request.system))]
    messages =
      system
      + request.messages.map { message in
        guard !message.images.isEmpty else {
          return Message(role: message.role.rawValue, content: .text(message.text))
        }
        let images = message.images.map { image in
          Part(
            type: "image_url",
            imageUrl: Part.ImageURL(
              url: "data:\(image.mediaType);base64,\(image.data.base64EncodedString())"))
        }
        return Message(
          role: message.role.rawValue,
          content: .parts([Part(type: "text", text: message.text)] + images))
      }
  }
}

struct OpenAIAnswerDecoder: AnswerDecoding {
  /// A streamed chunk; servers add fields of their own, which are ignored.
  private struct Chunk: Decodable {
    struct Choice: Decodable {
      struct Delta: Decodable {
        var content: String?
        var refusal: String?
      }
      var delta: Delta?
      var finishReason: String?
    }
    var choices: [Choice]?
    var error: ProviderErrorBody?
  }

  func read(_ event: ServerSentEvent) throws(ModelFailure) -> (text: String, done: Bool) {
    if event.data == "[DONE]" { return ("", true) }
    let chunk: Chunk
    do {
      chunk = try JSONDecoder.snakeCase.decode(Chunk.self, from: Data(event.data.utf8))
    } catch {
      throw .unreadable(detail: String(event.data.prefix(200)))
    }
    // An error sent mid-stream; OpenRouter gives it an HTTP-like numeric code.
    if let error = chunk.error { throw error.failure(status: error.code?.number) }
    guard let choice = chunk.choices?.first else { return ("", false) }
    if let refusal = choice.delta?.refusal, !refusal.isEmpty { throw .refused }
    let text = choice.delta?.content ?? ""
    guard let reason = choice.finishReason?.lowercased(), !reason.isEmpty else {
      return (text, false)
    }
    switch reason {
    case "length", "max_tokens": throw .truncated
    case "content_filter", "safety", "sensitive", "refusal": throw .refused
    // DeepSeek ends a stream it could not finish with this reason instead of an error.
    case "insufficient_system_resource", "error": throw .server(status: nil)
    // `stop`, and each server's own word for a normal end.
    default: return (text, true)
    }
  }

  static func failure(for response: HTTPURLResponse, body: Data) -> ModelFailure {
    let error = ProviderErrorBody.decode(body)
    return error?.failure(status: response.statusCode, retryAfter: response.retryAfter)
      ?? .status(
        response.statusCode, retryAfter: response.retryAfter,
        detail: String(decoding: body.prefix(300), as: UTF8.self))
  }
}

/// The error object compatible servers send, in the shapes seen in practice: `{"error": {…}}`,
/// Gemini's `[{"error": {…}}]`, or `{"error": "message"}`.
struct ProviderErrorBody: Decodable {
  enum Code: Decodable {
    case number(Int)
    case text(String)

    init(from decoder: any Decoder) throws {
      let container = try decoder.singleValueContainer()
      if let number = try? container.decode(Int.self) {
        self = .number(number)
      } else {
        let text = try container.decode(String.self)
        self = Int(text).map(Code.number) ?? .text(text)
      }
    }

    var number: Int? {
      if case .number(let number) = self { number } else { nil }
    }
  }

  /// Codes that mean the provider's content policy declined the request.
  private static let refusalCodes: Set = ["content_filter", "data_inspection_failed"]

  var message: String?
  var code: Code?

  private struct Envelope: Decodable { var error: ProviderErrorBody }

  init(from decoder: any Decoder) throws {
    if let message = try? decoder.singleValueContainer().decode(String.self) {
      self.message = message
      return
    }
    let container = try decoder.container(keyedBy: CodingKeys.self)
    message = try container.decodeIfPresent(String.self, forKey: .message)
    code = try? container.decodeIfPresent(Code.self, forKey: .code)
  }

  private enum CodingKeys: String, CodingKey { case message, code }

  static func decode(_ body: Data) -> ProviderErrorBody? {
    let decoder = JSONDecoder()
    if let envelope = try? decoder.decode(Envelope.self, from: body) { return envelope.error }
    return try? decoder.decode([Envelope].self, from: body).first?.error
  }

  func failure(status: Int?, retryAfter: Duration? = nil) -> ModelFailure {
    if case .text(let text) = code, Self.refusalCodes.contains(text) { return .refused }
    guard let status else { return .server(status: nil) }
    return .status(status, retryAfter: retryAfter, detail: message)
  }
}

private struct ModelList: Decodable {
  struct Entry: Decodable {
    var id: String
    var name: String?
  }
  var data: [Entry]
}
