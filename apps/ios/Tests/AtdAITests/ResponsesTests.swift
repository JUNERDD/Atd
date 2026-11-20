import AtdModel
import Foundation
import Testing

@testable import AtdAI

@Suite struct ResponsesTests {
  private let done = #"{"type":"response.completed"}"#
  private func sse(_ items: [String]) -> String {
    items.map { "data: \($0)\n\n" }.joined()
  }

  @Test func askSendsHistoryPhotosAndEffortAndOnlyDeliversAnswerText() async throws {
    let host = StubURLProtocol.host(
      .events(
        sse([
          #"{"type":"response.reasoning_summary_text.delta","delta":"planning"}"#,
          #"{"type":"response.output_text.delta","delta":"你"}"#,
          #"{"type":"response.output_text.delta","delta":"好"}"#,
          done,
        ]), pieceSize: 3))
    let connection = ProviderConnection(
      id: "a", presetID: "custom", name: "Test", api: .openAIResponses,
      baseURL: host.baseURL, model: "muse", reasoningEffort: .xhigh)
    let settings = AppSettings(connections: [connection])
    let secrets = MemorySecrets()
    secrets.setKey("fixture", for: "a")
    let runner = ModelRunner(settings: { settings }, secrets: secrets, session: host.session)
    let photo = ModelImage(data: Data([1, 2]), mediaType: "image/png")
    let request = ModelRequest(
      system: "Short",
      messages: [
        ModelMessage(.user, "Hi"), ModelMessage(.assistant, "Hello"),
        ModelMessage(.user, "Describe", images: [photo]),
      ])
    let answer = await collect(runner.stream(request, choice: .appDefault))
    #expect(answer.text == "你好" && answer.error == nil)
    let sent = try #require(host.requests.first)
    #expect(sent.url.path() == "/v1/responses")
    #expect(sent.headers["Authorization"] == "Bearer fixture")
    #expect(sent.json["store"] as? Bool == false && sent.json["stream"] as? Bool == true)
    #expect(sent.json["reasoning"] as? [String: String] == ["effort": "xhigh"])
    #expect(sent.json["instructions"] as? String == "Short")
    let input = try #require(sent.json["input"] as? [[String: Any]])
    #expect(input.compactMap { $0["role"] as? String } == ["user", "assistant", "user"])
    let parts = try #require(input.last?["content"] as? [[String: String]])
    #expect(
      parts == [
        ["type": "input_text", "text": "Describe"],
        ["type": "input_image", "image_url": "data:image/png;base64,AQI="],
      ])

    _ = await collect(runner.stream(request, choice: .connection(id: "a", model: "other")))
    #expect(host.requests.last?.json["reasoning"] == nil)
  }

  @Test(arguments: [
    (
      #"{"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}"#,
      ModelFailure.truncated
    ),
    (#"{"type":"response.refusal.delta","delta":"refused"}"#, .refused),
    (
      #"{"type":"response.failed","response":{"error":{"code":"rate_limit_exceeded"}}}"#,
      .rateLimited(retryAfter: nil)
    ),
    (#"{"type":"response.created"}"#, .server(status: nil)),
  ])
  func failuresNeverBecomeSuccessfulAnswers(payload: String, expected: ModelFailure) async {
    let host = StubURLProtocol.host(.events(sse([payload])))
    let client = OpenAIResponsesClient(
      baseURL: host.baseURL, apiKey: "k", model: "m", session: host.session)
    let result = await collect(client.stream(ModelRequest(system: "", messages: [])))
    #expect(result.error as? ModelFailure == expected)
  }

  @Test func discoverySelectsAProtocolAndOnlyAdvertisedEffortsForChatModels() async throws {
    let host = StubURLProtocol.host(
      .json(
        """
        {"data":[
          {"id":"muse","name":"Muse","type":"chat","recommended_api":"responses","capabilities":{"reasoning":{"effort":["low","xhigh","future"]}}},
          {"id":"claude","type":"chat","recommended_api":"messages"},
          {"id":"deepseek","type":"chat","recommended_api":"chat-completions"},
          {"id":"gemini","type":"chat","recommended_api":"interactions"},
          {"id":"image","type":"image"}]}
        """))
    var preset = try #require(ProviderPreset.preset("opencode-go"))
    preset.baseURL = host.baseURL.deletingLastPathComponent().appending(
      path: "inference/go/openai/v1")
    let models = try await preset.openCodeModels(key: "k", session: host.session)
    #expect(models.map(\.id) == ["muse", "claude", "deepseek", "gemini"])
    #expect(
      models.map(\.api) == [.openAIResponses, .anthropic, .openAICompatible, .openAIResponses])
    #expect(models[0].efforts == [.low, .xhigh])
    #expect(preset.openCodeURL(for: .anthropic)?.path() == "/inference/go/anthropic")
    #expect(host.requests.first?.url.path() == "/inference/go/v1/models")
  }

  @Test func versionedCustomMessagesURLDoesNotDuplicateTheVersion() throws {
    let host = StubURLProtocol.host(.events(""))
    let client = AnthropicClient(
      baseURL: host.baseURL, apiKey: "k", model: "m", session: host.session)
    let request = try client.urlRequest(for: ModelRequest(system: "", messages: []))
    #expect(request.url?.path() == "/v1/messages")
  }

  @Test func legacyConnectionsKeepTheirProtocolAndProviderDefaultEffort() throws {
    let json =
      #"{"id":"a","name":"A","presetID":"openai","api":"openAICompatible","baseURL":"https://example.test/v1","model":"existing"}"#
    let connection = try JSONDecoder().decode(ProviderConnection.self, from: Data(json.utf8))
    #expect(connection.api == .openAICompatible && connection.reasoningEffort == nil)
  }
}
