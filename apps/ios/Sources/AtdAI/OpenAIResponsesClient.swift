import AtdModel
import Foundation

/// Stateless Responses API requests replay the app's conversation and never request server storage.
public struct OpenAIResponsesClient: ModelBackend {
  public let baseURL: URL
  public let apiKey: String
  public let model: String
  public let effort: ReasoningEffort?
  let session: URLSession

  public init(
    baseURL: URL, apiKey: String, model: String, effort: ReasoningEffort? = nil,
    session: URLSession = .models
  ) {
    self.baseURL = baseURL
    self.apiKey = apiKey
    self.model = model
    self.effort = effort
    self.session = session
  }

  public func stream(_ request: ModelRequest) -> AsyncThrowingStream<String, any Error> {
    do {
      let post = try openAIPost(
        url: baseURL.appending(path: "responses"), key: apiKey,
        conversation: request.conversationID,
        body: ResponsesRequest(request, model: model, effort: effort))
      return HTTPStream.answer(
        post, session: session, headDeadline: HTTPStream.headDeadline, decoder: ResponsesDecoder())
    } catch {
      return .failing(ModelFailure.from(error))
    }
  }
}

private struct ResponsesRequest: Encodable {
  struct Reasoning: Encodable { let effort: ReasoningEffort }
  struct Message: Encodable {
    struct Part: Encodable {
      let type: String
      var text: String?
      var imageUrl: String?
    }
    let turn: ModelMessage

    enum CodingKeys: String, CodingKey { case role, content }

    func encode(to encoder: any Encoder) throws {
      var fields = encoder.container(keyedBy: CodingKeys.self)
      try fields.encode(turn.role.rawValue, forKey: .role)
      if turn.images.isEmpty {
        try fields.encode(turn.text, forKey: .content)
      } else {
        let images = turn.images.map {
          Part(
            type: "input_image",
            imageUrl: "data:\($0.mediaType);base64,\($0.data.base64EncodedString())")
        }
        try fields.encode([Part(type: "input_text", text: turn.text)] + images, forKey: .content)
      }
    }
  }

  let model: String
  let input: [Message]
  let instructions: String?
  let reasoning: Reasoning?
  let store = false
  let stream = true

  init(_ request: ModelRequest, model: String, effort: ReasoningEffort?) {
    self.model = model
    instructions = request.system.isEmpty ? nil : request.system
    input = request.messages.map(Message.init)
    reasoning = effort.map(Reasoning.init)
  }
}

private struct ResponsesDecoder: AnswerDecoding {
  struct Event: Decodable {
    struct Response: Decodable {
      struct Incomplete: Decodable { let reason: String? }
      let incompleteDetails: Incomplete?
      let error: Failure?
    }
    struct Failure: Decodable {
      let code: String?
      let message: String?
    }
    let type: String
    let delta: String?
    let response: Response?
    let code: String?
    let message: String?
  }

  func read(_ event: ServerSentEvent) throws(ModelFailure) -> (text: String, done: Bool) {
    guard let item = try? JSONDecoder.snakeCase.decode(Event.self, from: Data(event.data.utf8))
    else { throw .unreadable(detail: nil) }
    switch item.type {
    case "response.output_text.delta":
      guard let delta = item.delta else { throw .unreadable(detail: nil) }
      return (delta, false)
    case "response.completed": return ("", true)
    case "response.refusal.delta", "response.refusal.done": throw .refused
    case "response.incomplete":
      switch item.response?.incompleteDetails?.reason {
      case "content_filter": throw .refused
      case "max_output_tokens": throw .truncated
      default: throw .server(status: nil)
      }
    case "response.failed", "error":
      let failure = item.response?.error
      switch failure?.code ?? item.code {
      case "rate_limit_exceeded", "insufficient_quota": throw .rateLimited(retryAfter: nil)
      case "invalid_api_key": throw .invalidKey
      case "model_not_found": throw .notFound
      case "content_filter": throw .refused
      case "invalid_request_error", "context_length_exceeded":
        throw .rejected(detail: failure?.message ?? item.message)
      default: throw .server(status: nil)
      }
    default: return ("", false)
    }
  }

  static func failure(for response: HTTPURLResponse, body: Data) -> ModelFailure {
    OpenAIAnswerDecoder.failure(for: response, body: body)
  }
}
