import Foundation

extension URLSessionConfiguration {
  /// Model requests: nothing cached or stored, no waiting for a network to appear, and at most
  /// 30 s between two pieces of a response. Nothing is retried: a streamed answer sent twice is
  /// billed twice, so a failure offers 重试 instead.
  public static var models: URLSessionConfiguration {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 30
    configuration.waitsForConnectivity = false
    configuration.urlCache = nil
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    return configuration
  }
}

extension URLSession {
  /// The session every model request uses unless a caller passes its own.
  public static let models = URLSession(configuration: .models)
}

func openAIPost(
  url: URL, key: String, conversation: UUID?, body: some Encodable
) throws -> URLRequest {
  var post = URLRequest(url: url)
  post.httpMethod = "POST"
  post.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
  post.setValue("application/json", forHTTPHeaderField: "Content-Type")
  post.setValue("text/event-stream", forHTTPHeaderField: "Accept")
  post.identifyOpenCodeSession(conversation)
  post.httpBody = try JSONEncoder.snakeCase.encode(body)
  return post
}

/// How a protocol reads its streamed answers and its errors.
protocol AnswerDecoding: Sendable {
  /// Reads one event: the text it adds, and whether the answer is now complete.
  mutating func read(_ event: ServerSentEvent) throws(ModelFailure) -> (text: String, done: Bool)
  /// What an unsuccessful response stands for, from its status, headers and body.
  static func failure(for response: HTTPURLResponse, body: Data) -> ModelFailure
}

enum HTTPStream {
  /// How long a request may wait for the response head (the connect timeout); after it, the
  /// session's limit between chunks applies.
  static let headDeadline: Duration = .seconds(15)
  /// How much of an error body is kept for its message.
  static let errorBodyLimit = 64 * 1024

  /// Sends `request` and streams the text of the answer `Decoder` reads from its events.
  static func answer<Decoder: AnswerDecoding>(
    _ request: URLRequest, session: URLSession, headDeadline: Duration, decoder: Decoder
  ) -> AsyncThrowingStream<String, any Error> {
    AsyncThrowingStream { continuation in
      let task = Task {
        do {
          try await read(request, session: session, headDeadline: headDeadline, decoder: decoder) {
            continuation.yield($0)
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: ModelFailure.from(error))
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  /// Sends a request whose successful response is one JSON document.
  static func json<Document: Decodable>(
    _ request: URLRequest, session: URLSession, as type: Document.Type,
    failure: (HTTPURLResponse, Data) -> ModelFailure
  ) async throws -> Document {
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      throw ModelFailure.from(error)
    }
    guard let response = response as? HTTPURLResponse else {
      throw ModelFailure.unreadable(detail: nil)
    }
    guard (200..<300).contains(response.statusCode) else {
      throw failure(response, data.prefix(errorBodyLimit))
    }
    do {
      return try JSONDecoder.snakeCase.decode(type, from: data)
    } catch {
      throw ModelFailure.unreadable(detail: String(describing: error))
    }
  }

  private static func read<Decoder: AnswerDecoding>(
    _ request: URLRequest, session: URLSession, headDeadline: Duration, decoder: Decoder,
    emit: (String) -> Void
  ) async throws {
    var decoder = decoder
    var parser = ServerSentEventParser()
    var head: HTTPURLResponse?
    var errorBody = Data()
    for try await part in ResponseParts.load(request, session: session, headDeadline: headDeadline)
    {
      switch part {
      case .head(let response):
        head = response
        if response.isSuccess, response.mimeType != "text/event-stream" {
          throw ModelFailure.unreadable(detail: response.mimeType)
        }
      case .body(let data):
        guard let head, head.isSuccess else {
          errorBody.append(data.prefix(max(errorBodyLimit - errorBody.count, 0)))
          continue
        }
        for event in parser.push(data) {
          let (text, done) = try decoder.read(event)
          if !text.isEmpty { emit(text) }
          if done { return }
        }
      }
    }
    if let head, !head.isSuccess { throw Decoder.failure(for: head, body: errorBody) }
    // The body ended before the answer said it was complete.
    throw ModelFailure.server(status: nil)
  }
}

extension HTTPURLResponse {
  var isSuccess: Bool { (200..<300).contains(statusCode) }

  /// The `Retry-After` delay, when it is given in seconds (as the providers here send it).
  var retryAfter: Duration? {
    value(forHTTPHeaderField: "Retry-After").flatMap(Double.init).map { .seconds($0) }
  }
}

extension JSONDecoder {
  /// Both protocols name their fields in snake case.
  static var snakeCase: JSONDecoder {
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    return decoder
  }
}

extension JSONEncoder {
  static var snakeCase: JSONEncoder {
    let encoder = JSONEncoder()
    encoder.keyEncodingStrategy = .convertToSnakeCase
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return encoder
  }
}

/// What a response delivers, in order: its head, then its body in pieces as they arrive.
enum ResponsePart: Sendable {
  case head(HTTPURLResponse)
  case body(Data)
}

/// Loads one request through a task delegate, so the body arrives in the pieces the network
/// delivers and the head can have its own deadline.
private final class ResponseParts: NSObject, URLSessionDataDelegate, Sendable {
  private let continuation: AsyncThrowingStream<ResponsePart, any Error>.Continuation
  private let deadline: Task<Void, Never>

  static func load(_ request: URLRequest, session: URLSession, headDeadline: Duration)
    -> AsyncThrowingStream<ResponsePart, any Error>
  {
    let (parts, continuation) = AsyncThrowingStream.makeStream(of: ResponsePart.self)
    let task = session.dataTask(with: request)
    let delegate = ResponseParts(continuation: continuation, headDeadline: headDeadline)
    task.delegate = delegate
    continuation.onTermination = { _ in
      delegate.deadline.cancel()
      task.cancel()
    }
    task.resume()
    return parts
  }

  private init(
    continuation: AsyncThrowingStream<ResponsePart, any Error>.Continuation,
    headDeadline: Duration
  ) {
    self.continuation = continuation
    deadline = Task {
      guard (try? await Task.sleep(for: headDeadline)) != nil else { return }
      continuation.finish(throwing: URLError(.timedOut))
    }
  }

  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void
  ) {
    deadline.cancel()
    if let response = response as? HTTPURLResponse {
      continuation.yield(.head(response))
      completionHandler(.allow)
    } else {
      continuation.finish(throwing: URLError(.badServerResponse))
      completionHandler(.cancel)
    }
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    continuation.yield(.body(data))
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?
  ) {
    deadline.cancel()
    if let error {
      continuation.finish(throwing: error)
    } else {
      continuation.finish()
    }
  }
}
