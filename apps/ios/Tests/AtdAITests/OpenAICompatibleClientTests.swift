import Foundation
import Testing

@testable import AtdAI

@Suite struct OpenAICompatibleClientTests {
  private func client(_ host: StubHost) -> OpenAICompatibleClient {
    OpenAICompatibleClient(
      baseURL: host.baseURL, apiKey: "test-key", model: "test-model", session: host.session)
  }

  private func chunk(_ delta: String, finish: String? = nil) -> String {
    let reason = finish.map { "\"\($0)\"" } ?? "null"
    return "data: {\"choices\":[{\"index\":0,\"delta\":\(delta),\"finish_reason\":\(reason)}]}\n\n"
  }

  @Test func requestsCarryTheKeyModelAndTurns() async throws {
    let host = StubURLProtocol.host(.events(chunk("{\"content\":\"ok\"}", finish: "stop")))
    let photo = ModelImage(data: Data([1, 2, 3]), mediaType: "image/jpeg")
    let request = ModelRequest(
      system: "Be brief.",
      messages: [
        ModelMessage(.user, "First"), ModelMessage(.assistant, "Answer"),
        ModelMessage(.user, "What is this?", images: [photo]),
      ])
    _ = await collect(client(host).stream(request))

    let sent = try #require(host.requests.first)
    #expect(sent.method == "POST")
    #expect(sent.url.path() == "/v1/chat/completions")
    #expect(sent.headers["Authorization"] == "Bearer test-key")
    let body = sent.json
    #expect(body["model"] as? String == "test-model")
    #expect(body["stream"] as? Bool == true)
    #expect(body["max_tokens"] == nil && body["temperature"] == nil)
    let messages = try #require(body["messages"] as? [[String: Any]])
    #expect(messages.map { $0["role"] as? String } == ["system", "user", "assistant", "user"])
    #expect(messages[0]["content"] as? String == "Be brief.")
    #expect(messages[1]["content"] as? String == "First")
    let parts = try #require(messages[3]["content"] as? [[String: Any]])
    #expect(parts[0]["type"] as? String == "text" && parts[0]["text"] as? String == "What is this?")
    let image = try #require(parts[1]["image_url"] as? [String: Any])
    #expect(image["url"] as? String == "data:image/jpeg;base64,AQID")
  }

  @Test func streamsContentAndLeavesReasoningOut() async {
    let body =
      chunk("{\"role\":\"assistant\",\"content\":\"\"}")
      + ": OPENROUTER PROCESSING\n\n"
      + chunk("{\"reasoning_content\":\"想一想\"}")
      + chunk("{\"content\":\"你好\"}")
      + chunk("{\"content\":\"，世界\"}")
      + chunk("{}", finish: "stop")
      + "data: [DONE]\n\n"
    let host = StubURLProtocol.host(.events(body, pieceSize: 5))
    let answer = await collect(client(host).stream(ModelRequest(system: "", messages: [])))
    #expect(answer.text == "你好，世界")
    #expect(answer.error == nil)
  }

  @Test(arguments: [
    ("length", ModelFailure.truncated),
    ("content_filter", .refused),
    ("insufficient_system_resource", .server(status: nil)),
  ])
  func finishReasonsMap(reason: String, failure: ModelFailure) async {
    let host = StubURLProtocol.host(.events(chunk("{\"content\":\"partial\"}", finish: reason)))
    let answer = await collect(client(host).stream(ModelRequest(system: "", messages: [])))
    #expect(answer.error as? ModelFailure == failure)
  }

  @Test(arguments: [
    (
      401, "{\"error\":{\"message\":\"Incorrect API key\",\"code\":\"invalid_api_key\"}}", [:],
      ModelFailure.invalidKey
    ),
    (
      429, "{\"error\":{\"message\":\"Slow down\"}}", ["Retry-After": "3"],
      .rateLimited(retryAfter: .seconds(3))
    ),
    (402, "{\"error\":{\"message\":\"Insufficient Balance\"}}", [:], .rateLimited(retryAfter: nil)),
    (404, "{\"error\":{\"message\":\"The model does not exist\"}}", [:], .notFound),
    (
      400, "{\"error\":{\"message\":\"Bad image\",\"code\":null}}", [:],
      .rejected(detail: "Bad image")
    ),
    (400, "{\"error\":{\"message\":\"Filtered\",\"code\":\"content_filter\"}}", [:], .refused),
    (
      400, "[{\"error\":{\"code\":400,\"message\":\"API key not valid\"}}]", [:],
      .rejected(detail: "API key not valid")
    ),
    (503, "<html>busy</html>", [:], .server(status: 503)),
  ])
  func errorResponsesMap(
    status: Int, body: String, headers: [String: String], failure: ModelFailure
  )
    async
  {
    let host = StubURLProtocol.host(.error(status, body, headers: headers))
    let answer = await collect(client(host).stream(ModelRequest(system: "", messages: [])))
    #expect(answer.error as? ModelFailure == failure)
  }

  @Test func errorsSentMidStreamMap() async {
    let body =
      chunk("{\"content\":\"Hi\"}") + "data: {\"error\":{\"code\":502,\"message\":\"x\"}}\n\n"
    let host = StubURLProtocol.host(.events(body))
    let answer = await collect(client(host).stream(ModelRequest(system: "", messages: [])))
    #expect(answer.text == "Hi")
    #expect(answer.error as? ModelFailure == .server(status: 502))
  }

  @Test func aStreamThatEndsEarlyIsAServerFailure() async {
    let host = StubURLProtocol.host(.events(chunk("{\"content\":\"Hal\"}")))
    let answer = await collect(client(host).stream(ModelRequest(system: "", messages: [])))
    #expect(answer.error as? ModelFailure == .server(status: nil))
  }

  @Test func aWebPageIsUnreadable() async {
    let page = StubURLProtocol.Reply(
      headers: ["Content-Type": "text/html"], pieces: [Data("<html></html>".utf8)])
    let answer = await collect(
      client(StubURLProtocol.host(page)).stream(ModelRequest(system: "", messages: [])))
    #expect(answer.error as? ModelFailure == .unreadable(detail: "text/html"))
  }

  @Test func noHeadWithinTheDeadlineIsATimeout() async {
    var slow = client(StubURLProtocol.host(StubURLProtocol.Reply(hangs: true)))
    slow.headDeadline = .milliseconds(200)
    let answer = await collect(slow.stream(ModelRequest(system: "", messages: [])))
    #expect(answer.error as? ModelFailure == .timedOut)
  }

  @Test func listsModels() async throws {
    let host = StubURLProtocol.host(
      .json("{\"object\":\"list\",\"data\":[{\"id\":\"a\"},{\"id\":\"b\",\"name\":\"B\"}]}"))
    let models = try await client(host).models()
    #expect(models == [ModelInfo(id: "a"), ModelInfo(id: "b", name: "B")])
    #expect(host.requests.first?.url.path() == "/v1/models")
    #expect(host.requests.first?.headers["Authorization"] == "Bearer test-key")
  }
}
