import AtdModel
import Foundation

/// A provider as one connection reaches it: protocol, address and key.
public struct ProviderEndpoint: Sendable {
  public var api: ProviderAPI
  public var baseURL: URL
  public var effort: ReasoningEffort?
  public var key: String

  public init(api: ProviderAPI, baseURL: URL, key: String, effort: ReasoningEffort? = nil) {
    self.effort = effort
    self.api = api
    self.baseURL = baseURL
    self.key = key
  }

  public func backend(model: String, session: URLSession = .models) -> any ModelBackend {
    switch api {
    case .openAICompatible:
      var client = OpenAICompatibleClient(
        baseURL: baseURL, apiKey: key, model: model, session: session)
      client.effort = effort
      return client
    case .openAIResponses:
      return OpenAIResponsesClient(
        baseURL: baseURL, apiKey: key, model: model, effort: effort, session: session)
    case .anthropic:
      return AnthropicClient(baseURL: baseURL, apiKey: key, model: model, session: session)
    }
  }

  /// The models the key can use, in the provider's order.
  public func models(session: URLSession = .models) async throws -> [ModelInfo] {
    switch api {
    case .openAICompatible, .openAIResponses:
      try await OpenAICompatibleClient(baseURL: baseURL, apiKey: key, model: "", session: session)
        .models()
    case .anthropic:
      try await AnthropicClient(baseURL: baseURL, apiKey: key, model: "", session: session)
        .models()
    }
  }

  /// Asks `model` for a one-word reply and returns as soon as text arrives, so a connection is
  /// known to work end to end (key, address and model) before commands rely on it.
  public func test(model: String, session: URLSession = .models) async throws {
    let request = ModelRequest(system: "", messages: [ModelMessage(.user, "Reply with OK.")])
    for try await delta in backend(model: model, session: session).stream(request)
    where !delta.isEmpty {
      return
    }
    throw ModelFailure.unreadable(detail: nil)
  }
}

/// A model an endpoint lists.
public struct ModelInfo: Sendable, Equatable, Identifiable {
  public var id: String
  /// The provider's display name, when it gives one ("Claude Opus 5.5").
  public var name: String?

  public var api: ProviderAPI?
  public var efforts: [ReasoningEffort]?

  public init(
    id: String, name: String? = nil, api: ProviderAPI? = nil, efforts: [ReasoningEffort]? = nil
  ) {
    self.api = api
    self.efforts = efforts
    self.id = id
    self.name = name
  }
}

/// Runs requests on the person's connections. A command's own choice wins; when it names a
/// connection that was removed, or asks for the app default, the default connection answers.
public struct ModelRunner: TextGenerating {
  private let settings: @Sendable () -> AppSettings
  private let secrets: any SecretStoring
  private let session: URLSession

  /// - Parameter settings: the current settings, read at every request so a connection added in
  ///   the app is used without restarting the keyboard.
  public init(
    settings: @escaping @Sendable () -> AppSettings,
    secrets: any SecretStoring = KeychainSecretStore(), session: URLSession = .models
  ) {
    self.settings = settings
    self.secrets = secrets
    self.session = session
  }

  public func stream(_ request: ModelRequest, choice: ModelChoice) -> AsyncThrowingStream<
    String, any Error
  > {
    do {
      return try backend(for: choice).stream(request)
    } catch {
      return .failing(error)
    }
  }

  /// The model `choice` resolves to, ready to stream.
  public func backend(for choice: ModelChoice) throws(ModelFailure) -> any ModelBackend {
    guard let resolved = settings().resolve(choice) else { throw .noModel }
    let connection = resolved.connection
    let model = resolved.model
    guard let key = try? secrets.key(for: connection.id), !key.isEmpty else {
      throw .invalidKey
    }
    // Effort and a discovered route belong to the saved model. A different OpenCode model
    // can use the gateway's Responses translation without inheriting those settings.
    if model != connection.model, let preset = ProviderPreset.preset(connection.presetID),
      let url = preset.openCodeURL(for: .openAIResponses)
    {
      return ProviderEndpoint(api: .openAIResponses, baseURL: url, key: key)
        .backend(model: model, session: session)
    }
    return ProviderEndpoint(
      api: connection.api, baseURL: connection.baseURL, key: key,
      effort: model == connection.model ? connection.reasoningEffort : nil
    )
    .backend(model: model, session: session)
  }
}
