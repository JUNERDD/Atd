import Foundation
import Testing

@testable import AtdModel

/// `AppSettings.resolve(_:)`: the one answer to which connection and model a run uses.
@Suite struct ModelChoiceTests {
  private func settings() throws -> AppSettings {
    let url = try #require(URL(string: "https://api.example.com/v1"))
    var settings = AppSettings.initial()
    settings.upsert(
      ProviderConnection(
        id: "a", presetID: "custom", name: "A", api: .openAICompatible, baseURL: url,
        model: "model-a"))
    settings.upsert(
      ProviderConnection(
        id: "b", presetID: "anthropic", name: "B", api: .anthropic, baseURL: url,
        model: "model-b"))
    settings.defaultConnectionID = "b"
    return settings
  }

  @Test func withoutConnectionsNothingRuns() {
    #expect(AppSettings.initial().resolve(.appDefault) == nil)
    #expect(AppSettings.initial().resolve(.connection(id: "a", model: "x")) == nil)
  }

  @Test func theDefaultRunsWithItsOwnModel() throws {
    let run = try #require(try settings().resolve(.appDefault))
    #expect(run.connection.id == "b")
    #expect(run.model == "model-b")
    #expect(!run.isChosen)
  }

  @Test func aChosenConnectionRunsTheChosenModel() throws {
    let run = try #require(try settings().resolve(.connection(id: "a", model: "other")))
    #expect(run.connection.id == "a")
    #expect(run.model == "other")
    #expect(run.isChosen)
    // Choosing the default connection itself still counts as a choice, with its own model.
    let pinned = try #require(try settings().resolve(.connection(id: "b", model: "small")))
    #expect(pinned.model == "small")
    #expect(pinned.isChosen)
  }

  @Test func aRemovedConnectionFallsBackToTheDefault() throws {
    let run = try #require(try settings().resolve(.connection(id: "gone", model: "x")))
    #expect(run.connection.id == "b")
    #expect(run.model == "model-b")
    #expect(!run.isChosen)
  }
}
