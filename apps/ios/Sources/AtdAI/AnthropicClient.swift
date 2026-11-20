import Foundation

/// `POST {baseURL}/v1/messages` with `stream: true`.
///
/// Requests carry no sampling, thinking or effort settings, so each model answers with its own
/// defaults: API version 2026-10-21 rejects sampling parameters, and which thinking and effort
/// settings a model accepts differs by model. Only `text_delta` content is read; thinking blocks
/// are not part of the answer.
public struct AnthropicClient: ModelBackend {
  /// The API version every request names.
  static let version = "2026-10-21"

  public var baseURL: URL
  public var apiKey: String
  public var model: String
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
      post, session: session, headDeadline: headDeadline, decoder: AnthropicAnswerDecoder())
  }

  /// The models the key can use (`GET {baseURL}/v1/models`), newest first.
  public func models() async throws -> [ModelInfo] {
    var models: [ModelInfo] = []
    var after: String?
    repeat {
      var query = [URLQueryItem(name: "limit", value: "1000")]
      if let after { query.append(URLQueryItem(name: "after_id", value: after)) }
      var get = URLRequest(url: baseURL.appending(path: "v1/models").appending(queryItems: query))
      authorize(&get)
      let page = try await HTTPStream.json(
        get, session: session, as: ModelPage.self, failure: AnthropicAnswerDecoder.failure)
      models += page.data.map { ModelInfo(id: $0.id, name: $0.displayName) }
      after = page.hasMore ? page.lastId : nil
    } while after != nil
    return models
  }

  func urlRequest(for request: ModelRequest) throws -> URLRequest {
    var post = URLRequest(url: baseURL.appending(path: "v1/messages"))
    post.httpMethod = "POST"
    authorize(&post)
    post.setValue("application/json", forHTTPHeaderField: "Content-Type")
    post.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    post.httpBody = try JSONEncoder.snakeCase.encode(
      MessagesRequest(model: model, request: request))
    return post
  }

  private func authorize(_ request: inout URLRequest) {
    request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
    request.setValue(Self.version, forHTTPHeaderField: "anthropic-version")
  }
}

/// The request body. A turn with images puts them before its text, as the API recommends.
struct MessagesRequest: Encodable {
  struct Message: Encodable {
    var role: String
    var content: Content
  }

  enum Content: Encodable {
    case text(String)
    case blocks([Block])

    func encode(to encoder: any Encoder) throws {
      var container = encoder.singleValueContainer()
      switch self {
      case .text(let text): try container.encode(text)
      case .blocks(let blocks): try container.encode(blocks)
      }
    }
  }

  struct Block: Encodable {
    struct Source: Encodable {
      var type = "base64"
      var mediaType: String
      var data: String
    }
    var type: String
    var text: String?
    var source: Source?
  }

  var model: String
  var maxTokens: Int
  var stream = true
  var system: String?
  var messages: [Message]

  init(model: String, request: ModelRequest) {
    self.model = model
    maxTokens = request.maxOutputTokens
    system = request.system.isEmpty ? nil : request.system
    messages = request.messages.map { message in
      guard !message.images.isEmpty else {
        return Message(role: message.role.rawValue, content: .text(message.text))
      }
      let images = message.images.map { image in
        Block(
          type: "image",
          source: Block.Source(
            mediaType: image.mediaType, data: image.data.base64EncodedString()))
      }
      return Message(
        role: message.role.rawValue,
        content: .blocks(images + [Block(type: "text", text: message.text)]))
    }
  }
}

struct AnthropicAnswerDecoder: AnswerDecoding {
  private struct Event: Decodable {
    struct Block: Decodable {
      var type: String
      var text: String?
    }
    struct Delta: Decodable {
      var type: String?
      var text: String?
      var stopReason: String?
    }
    var type: String
    var contentBlock: Block?
    var delta: Delta?
    var error: APIError?
  }

  func read(_ event: ServerSentEvent) throws(ModelFailure) -> (text: String, done: Bool) {
    let payload: Event
    do {
      payload = try JSONDecoder.snakeCase.decode(Event.self, from: Data(event.data.utf8))
    } catch {
      throw .unreadable(detail: String(event.data.prefix(200)))
    }
    switch payload.type {
    case "content_block_start" where payload.contentBlock?.type == "text":
      return (payload.contentBlock?.text ?? "", false)
    case "content_block_delta" where payload.delta?.type == "text_delta":
      return (payload.delta?.text ?? "", false)
    case "message_delta":
      switch payload.delta?.stopReason {
      case nil: return ("", false)
      case "max_tokens", "model_context_window_exceeded": throw .truncated
      case "refusal": throw .refused
      default: return ("", true)
      }
    case "message_stop":
      return ("", true)
    case "error":
      throw payload.error?.failure ?? .server(status: nil)
    // message_start, ping, thinking and other blocks, and event types added later.
    default:
      return ("", false)
    }
  }

  static func failure(for response: HTTPURLResponse, body: Data) -> ModelFailure {
    struct Envelope: Decodable { var error: APIError }
    let message = (try? JSONDecoder().decode(Envelope.self, from: body))?.error.message
    return .status(response.statusCode, retryAfter: response.retryAfter, detail: message)
  }
}

/// `{"type": "overloaded_error", "message": "Overloaded"}`, in an error response or event.
private struct APIError: Decodable {
  var type: String?
  var message: String?

  /// For an error event mid-stream, which has a type but no HTTP status.
  var failure: ModelFailure {
    switch type {
    case "authentication_error", "permission_error": .invalidKey
    case "rate_limit_error", "billing_error": .rateLimited(retryAfter: nil)
    case "not_found_error": .notFound
    case "invalid_request_error", "request_too_large": .rejected(detail: message)
    case "timeout_error": .timedOut
    case "overloaded_error": .server(status: 529)
    default: .server(status: nil)
    }
  }
}

private struct ModelPage: Decodable {
  struct Entry: Decodable {
    var id: String
    var displayName: String?
  }
  var data: [Entry]
  var hasMore: Bool
  var lastId: String?
}
