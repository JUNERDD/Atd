import Foundation
import Testing

@testable import AtdAI

@Suite struct AnthropicClientTests {
  private func client(_ host: StubHost) -> AnthropicClient {
    // The stub's base URL ends in /v1; Anthropic's base URL is the bare host.
    AnthropicClient(
      baseURL: host.baseURL.deletingLastPathComponent(), apiKey: "test-key", model: "test-model",
      session: host.session)
  }

  private func event(_ type: String, _ json: String) -> String {
    "event: \(type)\ndata: \(json)\n\n"
  }

  private func ending(_ stopReason: String) -> String {
    event(
      "message_delta", "{\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"\(stopReason)\"}}")
      + event("message_stop", "{\"type\":\"message_stop\"}")
  }

  private func text(_ text: String) -> String {
    event(
      "content_block_delta",
      "{\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"\(text)\"}}"
    )
  }

  @Test func requestsCarryTheKeyVersionAndCeiling() async throws {
    let host = StubURLProtocol.host(.events(text("ok") + ending("end_turn")))
    let photo = ModelImage(data: Data([1, 2, 3]), mediaType: "image/png")
    let request = ModelRequest(
      system: "Be brief.", messages: [ModelMessage(.user, "What is this?", images: [photo])])
    _ = await collect(client(host).stream(request))

    let sent = try #require(host.requests.first)
    #expect(sent.url.path() == "/v1/messages")
    #expect(sent.headers["x-api-key"] == "test-key")
    #expect(sent.headers["anthropic-version"] == "2026-10-21")
    let body = sent.json
    #expect(body["model"] as? String == "test-model")
    #expect(body["max_tokens"] as? Int == ModelRequest.defaultMaxOutputTokens)
    #expect(body["stream"] as? Bool == true)
    #expect(body["system"] as? String == "Be brief.")
    #expect(body["temperature"] == nil && body["thinking"] == nil)
    let messages = try #require(body["messages"] as? [[String: Any]])
    let blocks = try #require(messages.first?["content"] as? [[String: Any]])
    #expect(blocks.map { $0["type"] as? String } == ["image", "text"])
    let source = try #require(blocks[0]["source"] as? [String: Any])
    #expect(source["type"] as? String == "base64")
    #expect(source["media_type"] as? String == "image/png")
    #expect(source["data"] as? String == "AQID")
  }

  @Test func anEmptySystemPromptIsLeftOut() async throws {
    let host = StubURLProtocol.host(.events(ending("end_turn")))
    _ = await collect(
      client(host).stream(ModelRequest(system: "", messages: [ModelMessage(.user, "Hi")])))
    let body = try #require(host.requests.first).json
    #expect(body["system"] == nil)
    #expect((body["messages"] as? [[String: Any]])?.first?["content"] as? String == "Hi")
  }

  @Test func streamsTextAndSkipsThinking() async {
    let body =
      event(
        "message_start", "{\"type\":\"message_start\",\"message\":{\"id\":\"m\",\"content\":[]}}")
      + event(
        "content_block_start",
        "{\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}"
      )
      + event(
        "content_block_delta",
        "{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"signature_delta\",\"signature\":\"s\"}}"
      )
      + event("content_block_stop", "{\"type\":\"content_block_stop\",\"index\":0}")
      + event("ping", "{\"type\":\"ping\"}")
      + event(
        "content_block_start",
        "{\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}"
      )
      + text("润色")
      + text("好了")
      + ending("end_turn")
    let host = StubURLProtocol.host(.events(body, pieceSize: 3))
    let answer = await collect(client(host).stream(ModelRequest(system: "", messages: [])))
    #expect(answer.text == "润色好了")
    #expect(answer.error == nil)
  }

  @Test(arguments: [
    ("refusal", ModelFailure.refused),
    ("max_tokens", .truncated),
    ("model_context_window_exceeded", .truncated),
  ])
  func stopReasonsMap(reason: String, failure: ModelFailure) async {
    let host = StubURLProtocol.host(.events(text("part") + ending(reason)))
    let answer = await collect(client(host).stream(ModelRequest(system: "", messages: [])))
    #expect(answer.error as? ModelFailure == failure)
  }

  @Test func errorEventsMap() async {
    let error = event(
      "error",
      "{\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}")
    let host = StubURLProtocol.host(.events(text("Hi") + error))
    let answer = await collect(client(host).stream(ModelRequest(system: "", messages: [])))
    #expect(answer.error as? ModelFailure == .server(status: 529))
  }

  @Test(arguments: [
    (401, "authentication_error", "invalid x-api-key", [:], ModelFailure.invalidKey),
    (
      429, "rate_limit_error", "Too many", ["retry-after": "7"],
      .rateLimited(retryAfter: .seconds(7))
    ),
    (
      400, "invalid_request_error", "max_tokens: too large", [:],
      .rejected(detail: "max_tokens: too large")
    ),
    (404, "not_found_error", "model: nope", [:], .notFound),
    (529, "overloaded_error", "Overloaded", [:], .server(status: 529)),
  ])
  func errorResponsesMap(
    status: Int, type: String, message: String, headers: [String: String], failure: ModelFailure
  ) async {
    let body = "{\"type\":\"error\",\"error\":{\"type\":\"\(type)\",\"message\":\"\(message)\"}}"
    let host = StubURLProtocol.host(.error(status, body, headers: headers))
    let answer = await collect(client(host).stream(ModelRequest(system: "", messages: [])))
    #expect(answer.error as? ModelFailure == failure)
  }

  @Test func listsModelsAcrossPages() async throws {
    let host = StubURLProtocol.host(
      .json(
        "{\"data\":[{\"id\":\"claude-a\",\"display_name\":\"Claude A\",\"type\":\"model\"}],\"has_more\":true,\"last_id\":\"claude-a\"}"
      ),
      .json("{\"data\":[{\"id\":\"claude-b\",\"display_name\":\"Claude B\"}],\"has_more\":false}"))
    let models = try await client(host).models()
    #expect(
      models == [
        ModelInfo(id: "claude-a", name: "Claude A"), ModelInfo(id: "claude-b", name: "Claude B"),
      ])
    let queries = host.requests.map { $0.url.query() ?? "" }
    #expect(queries == ["limit=1000", "limit=1000&after_id=claude-a"])
    #expect(host.requests.allSatisfy { $0.headers["anthropic-version"] == "2026-10-21" })
  }
}
