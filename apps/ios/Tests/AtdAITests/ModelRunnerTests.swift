import AtdModel
import Foundation
import Testing

@testable import AtdAI

@Suite struct ModelRunnerTests {
  private let answer =
    "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\n"

  private func connection(_ id: String, _ host: StubHost, model: String) -> ProviderConnection {
    ProviderConnection(
      id: id, presetID: ProviderPreset.customID, name: id, api: .openAICompatible,
      baseURL: host.baseURL, model: model)
  }

  @Test func withoutAConnectionThereIsNoModel() {
    let runner = ModelRunner(settings: { .initial() }, secrets: MemorySecrets())
    #expect(throws: ModelFailure.noModel) { try runner.backend(for: .appDefault) }
  }

  @Test func aConnectionWithoutAKeyHasAnInvalidKey() async {
    let host = StubURLProtocol.host(.events(answer))
    var settings = AppSettings.initial()
    settings.upsert(connection("a", host, model: "m"))
    let runner = ModelRunner(settings: { [settings] in settings }, secrets: MemorySecrets())
    let result = await collect(
      runner.stream(ModelRequest(system: "", messages: []), choice: .appDefault))
    #expect(result.error as? ModelFailure == .invalidKey)
    #expect(host.requests.isEmpty)
  }

  @Test func aCommandsChoiceWinsAndAMissingOneFallsBackToTheDefault() async throws {
    let first = StubURLProtocol.host(.events(answer))
    let second = StubURLProtocol.host(.events(answer))
    var settings = AppSettings.initial()
    settings.upsert(connection("a", first, model: "model-a"))
    settings.upsert(connection("b", second, model: "model-b"))
    let secrets = MemorySecrets()
    secrets.setKey("key-a", for: "a")
    secrets.setKey("key-b", for: "b")
    // Both stubs answer through one session that routes every made-up host.
    let runner = ModelRunner(
      settings: { [settings] in settings }, secrets: secrets, session: first.session)
    let request = ModelRequest(system: "", messages: [ModelMessage(.user, "Hi")])

    let chosen = await collect(
      runner.stream(request, choice: .connection(id: "b", model: "other-model")))
    #expect(chosen.text == "ok")
    let sent = try #require(second.requests.last)
    #expect(sent.json["model"] as? String == "other-model")
    #expect(sent.headers["Authorization"] == "Bearer key-b")

    _ = await collect(runner.stream(request, choice: .connection(id: "gone", model: "x")))
    _ = await collect(runner.stream(request, choice: .appDefault))
    #expect(first.requests.map { $0.json["model"] as? String } == ["model-a", "model-a"])
  }

  @Test func aTestPassesOnTheFirstText() async throws {
    let host = StubURLProtocol.host(.events(answer))
    let endpoint = ProviderEndpoint(api: .openAICompatible, baseURL: host.baseURL, key: "k")
    try await endpoint.test(model: "m", session: host.session)
    let silent = StubURLProtocol.host(
      .events("data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n"))
    let quiet = ProviderEndpoint(api: .openAICompatible, baseURL: silent.baseURL, key: "k")
    await #expect(throws: ModelFailure.unreadable(detail: nil)) {
      try await quiet.test(model: "m", session: silent.session)
    }
  }

  @Test func presetsAreCompleteAndUnique() {
    let presets = ProviderPreset.all()
    #expect(Set(presets.map(\.id)).count == presets.count)
    #expect(presets.filter { $0.baseURL == nil }.map(\.id) == [ProviderPreset.customID])
    #expect(presets.allSatisfy { $0.baseURL?.scheme ?? "https" == "https" && !$0.name.isEmpty })
    #expect(ProviderPreset.preset("anthropic")?.api == .anthropic)
  }
}
