import Foundation

/// The wire protocol a provider speaks. Presets (AtdAI's ProviderPreset) map to one of these.
public enum ProviderAPI: String, Codable, Sendable, CaseIterable {
  /// `POST {baseURL}/chat/completions`, streamed: OpenAI and every compatible endpoint.
  case openAICompatible
  /// `POST {baseURL}/responses`, streamed.
  case openAIResponses
  /// `POST {baseURL}/v1/messages`, streamed.
  case anthropic
}

/// Values a model can accept on the wire. A missing value leaves the choice to the provider.
public enum ReasoningEffort: String, Codable, CaseIterable, Sendable {
  case none, minimal, low, medium, high, xhigh, max
}

/// A provider the person connected with their own key. The key itself never lives here: it is in
/// the shared Keychain group under this connection's `id`.
public struct ProviderConnection: Codable, Sendable, Identifiable, Equatable, Hashable {
  public var id: String
  /// The preset it was created from (`openai`, `anthropic`, `custom`…), for its name and logo.
  public var presetID: String
  /// What the person sees, the preset's name unless they renamed it.
  public var name: String
  public var api: ProviderAPI
  public var baseURL: URL
  /// The model id requests use.
  public var model: String
  public var reasoningEffort: ReasoningEffort?

  public init(
    id: String = UUID().uuidString, presetID: String, name: String, api: ProviderAPI,
    baseURL: URL, model: String, reasoningEffort: ReasoningEffort? = nil
  ) {
    self.id = id
    self.presetID = presetID
    self.name = name
    self.api = api
    self.baseURL = baseURL
    self.model = model
    self.reasoningEffort = reasoningEffort
  }
}
